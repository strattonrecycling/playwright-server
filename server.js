const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------
// ALWAYS JSON SAFETY
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
    version: "v11-hydration-fixed",
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
      "--disable-dev-shm-usage"
    ]
  });
}

// ---------------------------------------------------
// PRODUCT SCRAPER (HYDRATION FIXED)
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

    // 🔥 HYDRATION STABILISATION DELAY
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {

      const clean = (t = "") =>
        t.replace(/\s+/g, " ").trim();

      // ---------------------------------------
      // TITLE (FORCED VALIDATION)
      // ---------------------------------------

      const h1 = document.querySelector("h1");
      const title = clean(h1?.innerText || "");

      const bodyText = document.body.innerText;

      const isValid =
        title &&
        title.length > 5 &&
        /BMW|CATALYTIC|CONVERTER|DPF|OEM/i.test(bodyText);

      // ---------------------------------------
      // PRODUCT BLOCK SELECTION (FIXED)
      // ---------------------------------------

      const container =
        document.querySelector(".product") ||
        document.querySelector("[class*='product']") ||
        document.querySelector("main") ||
        document.body;

      const text = clean(container.innerText);

      // ---------------------------------------
      // REFERENCES (OEM NUMBERS ONLY)
      // ---------------------------------------

      const references = [
        ...new Set(
          (text.match(/\b\d{6,12}\b/g) || [])
        )
      ].slice(0, 30);

      // ---------------------------------------
      // PRICE HINTS
      // ---------------------------------------

      const priceHints = [
        ...new Set(
          (text.match(/(\$\s?\d[\d\s,.]*)|(€\s?\d[\d\s,.]*)|(R\s?\d[\d\s,.]*)/g) || [])
        )
      ].slice(0, 10);

      // ---------------------------------------
      // PRODUCT DETAILS
      // ---------------------------------------

      const get = (label) => {
        const regex = new RegExp(
          `${label}\\s+(.*?)(?=Brand|Maker|Product Type|Years|Car Models|Ref|Share|$)`,
          "i"
        );
        const m = text.match(regex);
        return m ? clean(m[1]).slice(0, 300) : null;
      };

      const productDetails = {
        brand: get("Brand"),
        maker: get("Maker"),
        productType: get("Product Type"),
        years: get("Years"),
        carModels: get("Car Models"),
        ref: get("Ref")
      };

      // ---------------------------------------
      // IMAGES (FILTERED CLEAN)
      // ---------------------------------------

      const images = Array.from(document.images)
        .map(i => i.src)
        .filter(src =>
          src &&
          src.includes("uploads") &&
          !src.includes("flag") &&
          !src.includes("badge") &&
          !src.includes("logo")
        )
        .slice(0, 10);

      return {
        type: "product",
        title: isValid ? title : "INVALID_PRODUCT_CAPTURED",
        references,
        priceHints,
        productDetails,
        images,
        preview: text.slice(0, 1200)
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
    return res.status(500).json({
      ok: false,
      error: "Fatal server error",
      details: err.message
    });
  }
});

// ---------------------------------------------------
// GLOBAL SAFETY
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
  console.log(`🚀 v11 hydration-fixed scraper running on port ${PORT}`);
});
