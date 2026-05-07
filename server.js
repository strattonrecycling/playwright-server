const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------
// ALWAYS JSON SAFETY MIDDLEWARE (CRITICAL FIX)
// ---------------------------------------------------

app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

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
    version: "v10-bulletproof",
    timestamp: Date.now()
  });
});

// ---------------------------------------------------
// BROWSER FACTORY (ISOLATED PER REQUEST)
// ---------------------------------------------------

async function createBrowser() {
  return await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });
}

// ---------------------------------------------------
// SAFE PRODUCT SCRAPER
// ---------------------------------------------------

async function scrapeProduct(url) {
  let browser;

  try {
    browser = await createBrowser();

    const page = await browser.newPage();

    await page.setViewportSize({ width: 1366, height: 900 });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const clean = (t = "") => t.replace(/\s+/g, " ").trim();

      const main = document.querySelector("main") || document.body;

      const fullText = clean(main.innerText);

      const title =
        clean(document.querySelector("h1")?.innerText) ||
        "Unknown Product";

      const references = [
        ...new Set(
          (fullText.match(/\b[A-Z0-9\-]{5,20}\b/g) || [])
        )
      ].filter(r => /\d/.test(r)).slice(0, 30);

      const priceHints = [
        ...new Set(
          (fullText.match(/(\$\s?\d[\d\s,.]*)|(€\s?\d[\d\s,.]*)|(R\s?\d[\d\s,.]*)/g) || [])
        )
      ].slice(0, 10);

      const productDetails = {};

      const labels = ["Brand", "Maker", "Product Type", "Years", "Car Models", "Ref"];

      labels.forEach(label => {
        const regex = new RegExp(
          `${label}\\s+(.*?)(?=Brand|Maker|Product Type|Years|Car Models|Ref|Share|$)`,
          "i"
        );

        const match = fullText.match(regex);

        if (match?.[1]) {
          productDetails[label] = clean(match[1]).slice(0, 300);
        }
      });

      const images = Array.from(document.images)
        .map(img => img.src)
        .filter(src =>
          src &&
          (src.includes("/uploads/") || src.includes("http"))
        )
        .slice(0, 12);

      return {
        type: "product",
        title,
        references,
        priceHints,
        productDetails,
        images,
        preview: fullText.slice(0, 1200)
      };
    });

    await page.close();
    await browser.close();

    return {
      ok: true,
      data
    };

  } catch (err) {

    if (browser) {
      try { await browser.close(); } catch {}
    }

    return {
      ok: false,
      error: err.message
    };
  }
}

// ---------------------------------------------------
// ROUTE
// ---------------------------------------------------

app.post("/scrape-product", async (req, res) => {

  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "URL is required"
      });
    }

    const result = await scrapeProduct(url);

    return res.json(result);

  } catch (err) {

    // 🔥 ABSOLUTE SAFETY NET (NO HTML EVER)
    return res.status(500).json({
      ok: false,
      error: "Fatal server error",
      details: err.message
    });
  }
});

// ---------------------------------------------------
// GLOBAL SAFETY FALLBACK (CRITICAL)
// ---------------------------------------------------

app.use((err, req, res, next) => {
  res.status(500).json({
    ok: false,
    error: "Unhandled server crash",
    details: err.message
  });
});

// ---------------------------------------------------
// START
// ---------------------------------------------------

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Bulletproof scraper running on port ${PORT}`);
});
