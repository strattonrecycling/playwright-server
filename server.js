const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// -----------------------------------------------------
// FORCE JSON ONLY (CRITICAL FIX FOR "<!DOCTYPE")
// -----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

// -----------------------------------------------------
// HEALTH
// -----------------------------------------------------
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
    version: "v12-hardened",
    timestamp: Date.now()
  });
});

// -----------------------------------------------------
// BROWSER (STABLE CONFIG)
// -----------------------------------------------------
async function createBrowser() {
  return await chromium.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

// -----------------------------------------------------
// CORE SCRAPER
// -----------------------------------------------------
async function scrape(url) {
  let browser;

  try {
    browser = await createBrowser();
    const page = await browser.newPage();

    // realistic headers
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9"
    });

    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // smarter hydration wait (no long freezes)
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {

      const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

      // ---------------------------
      // TITLE FIX (ROBUST)
      // ---------------------------
      const title =
        clean(document.querySelector("h1")?.innerText) ||
        clean(document.querySelector("[class*='title']")?.innerText) ||
        clean(document.title);

      // ---------------------------
      // MAIN CONTAINER
      // ---------------------------
      const container =
        document.querySelector("main") ||
        document.body;

      const text = clean(container.innerText);

      // ---------------------------
      // OEM REFERENCES
      // ---------------------------
      const references = [
        ...new Set(text.match(/\b\d{6,14}\b/g) || [])
      ].slice(0, 30);

      // ---------------------------
      // PRICES
      // ---------------------------
      const priceHints = [
        ...new Set(text.match(/(\$\s?\d[\d\s,.]*)|(€\s?\d[\d\s,.]*)|(R\s?\d[\d\s,.]*)/g) || [])
      ].slice(0, 10);

      // ---------------------------
      // PRODUCT DETAILS EXTRACTION
      // ---------------------------
      const pick = (label) => {
        const r = new RegExp(`${label}\\s+(.*?)(?=Brand|Maker|Ref|Years|Car Models|$)`, "i");
        const m = text.match(r);
        return m ? clean(m[1]) : null;
      };

      const productDetails = {
        brand: pick("Brand"),
        maker: pick("Maker"),
        productType: pick("Product Type"),
        years: pick("Years"),
        carModels: pick("Car Models"),
        ref: pick("Ref")
      };

      // ---------------------------
      // IMAGES (FILTERED)
      // ---------------------------
      const images = Array.from(document.images)
        .map(i => i.src)
        .filter(src =>
          src &&
          src.includes("ecotradegroup") &&
          !src.includes("flag") &&
          !src.includes("logo") &&
          !src.includes("badge")
        )
        .slice(0, 10);

      return {
        type: url.includes("/product/") ? "product" : "search",
        title,
        references,
        priceHints,
        productDetails,
        images,
        preview: text.slice(0, 1200)
      };
    });

    await browser.close();

    return {
      ok: true,
      data
    };

  } catch (err) {
    if (browser) await browser.close().catch(() => {});

    return {
      ok: false,
      error: err.message
    };
  }
}

// -----------------------------------------------------
// ROUTE
// -----------------------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.json({
        ok: false,
        error: "URL_REQUIRED"
      });
    }

    const result = await scrape(url);

    return res.json(result);

  } catch (err) {
    return res.json({
      ok: false,
      error: "FATAL_SERVER_ERROR",
      message: err.message
    });
  }
});

// -----------------------------------------------------
// GLOBAL SAFETY NET (NO HTML EVER)
// -----------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);

  res.json({
    ok: false,
    error: "UNHANDLED_EXCEPTION",
    message: err.message
  });
});

// -----------------------------------------------------
// START
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 v12 hardened scraper running on port ${PORT}`);
});
