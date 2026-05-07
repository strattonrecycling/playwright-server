const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------
// HEALTH
// ---------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "catalytic-intelligence-api",
    status: "online"
  });
});

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "v8-refined-product-engine",
    timestamp: Date.now()
  });
});

// ---------------------------------------------------
// BROWSER
// ---------------------------------------------------

async function createBrowser() {

  return await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

// ---------------------------------------------------
// HELPERS
// ---------------------------------------------------

function isSearchUrl(url) {
  return url.includes("/search?");
}

function isProductUrl(url) {
  return url.includes("/product/");
}

// ---------------------------------------------------
// SEARCH EXTRACTION
// ---------------------------------------------------

async function extractSearch(page, url) {

  try {

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(5000);

    const results = await page.evaluate(() => {

      const links = Array.from(
        document.querySelectorAll("a")
      );

      const products = links
        .filter(link =>
          link.href &&
          link.href.includes("/product/")
        )
        .map(link => ({
          title: (link.innerText || "").trim(),
          url: link.href
        }))
        .filter(item =>
          item.url &&
          item.title
        );

      // Remove duplicates
      const unique = [];

      const seen = new Set();

      for (const item of products) {

        if (!seen.has(item.url)) {

          seen.add(item.url);

          unique.push(item);
        }
      }

      return unique.slice(0, 20);
    });

    return {
      ok: true,
      data: {
        type: "search",
        query: url,
        results,
        count: results.length
      }
    };

  } catch (error) {

    return {
      ok: false,
      error: error.message
    };
  }
}

// ---------------------------------------------------
// PRODUCT EXTRACTION
// ---------------------------------------------------

async function extractProduct(page, url) {

  try {

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    await page.waitForTimeout(4000);

    const data = await page.evaluate(() => {

      const clean = (txt = "") =>
        txt.replace(/\s+/g, " ").trim();

      // ---------------------------------
      // TARGET MAIN CONTENT
      // ---------------------------------

      const main =
        document.querySelector("main") ||
        document.body;

      const fullText = clean(main.innerText);

      // ---------------------------------
      // TITLE
      // ---------------------------------

      const title =
        clean(
          document.querySelector("h1")?.innerText
        ) ||
        "Unknown Product";

      // ---------------------------------
      // REFERENCES
      // ---------------------------------

      const references = [
        ...new Set(
          (
            fullText.match(/\b[A-Z0-9\-]{5,20}\b/g) || []
          )
        )
      ]
      .filter(ref => /\d/.test(ref))
      .slice(0, 25);

      // ---------------------------------
      // PRICE HINTS
      // ---------------------------------

      const priceHints = [
        ...new Set(
          (
            fullText.match(
              /(R\s?\d[\d\s,.]*)|(€\s?\d[\d\s,.]*)|(\$\s?\d[\d\s,.]*)/g
            ) || []
          )
        )
      ].slice(0, 10);

      // ---------------------------------
      // PRODUCT DETAILS
      // ---------------------------------

      const productDetails = {};

      const labels = [
        "Brand",
        "Maker",
        "Product Type",
        "Years",
        "Car Models",
        "Ref"
      ];

      labels.forEach(label => {

        const regex = new RegExp(
          `${label}\\s+(.*?)(?=Brand|Maker|Product Type|Years|Car Models|Ref|Share|$)`,
          "i"
        );

        const match = fullText.match(regex);

        if (match?.[1]) {

          productDetails[label] =
            clean(match[1]).slice(0, 300);
        }
      });

      // ---------------------------------
      // CLEAN IMAGES
      // ---------------------------------

      const images = Array.from(document.images)
        .map(img => img.src)
        .filter(src =>
          src &&
          src.includes("/uploads/") &&
          !src.includes("flag") &&
          !src.includes("badge")
        )
        .slice(0, 10);

      return {
        type: "product",
        title,
        references,
        priceHints,
        productDetails,
        images,
        preview: fullText.slice(0, 1000)
      };
    });

    return {
      ok: true,
      data
    };

  } catch (error) {

    return {
      ok: false,
      error: error.message
    };
  }
}

// ---------------------------------------------------
// API
// ---------------------------------------------------

app.post("/scrape-product", async (req, res) => {

  let browser;

  try {

    const { url } = req.body;

    if (!url) {

      return res.json({
        ok: false,
        error: "URL is required"
      });
    }

    browser = await createBrowser();

    const page = await browser.newPage({

      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36"
    });

    await page.setViewportSize({
      width: 1400,
      height: 1200
    });

    let result;

    // ---------------------------------
    // ROUTING
    // ---------------------------------

    if (isSearchUrl(url)) {

      result = await extractSearch(page, url);

    } else if (isProductUrl(url)) {

      result = await extractProduct(page, url);

    } else {

      result = {
        ok: false,
        error: "Unsupported EcoTrade URL"
      };
    }

    await page.close();

    await browser.close();

    return res.json(result);

  } catch (error) {

    if (browser) {

      try {
        await browser.close();
      } catch {}
    }

    return res.json({
      ok: false,
      error: error.message
    });
  }
});

// ---------------------------------------------------
// START
// ---------------------------------------------------

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    `Catalytic Intelligence v8 running on port ${PORT}`
  );
});
