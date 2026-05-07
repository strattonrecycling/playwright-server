const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------------------------------
// FORCE JSON ONLY (NO HTML EVER)
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
    service: "catalytic-intelligence-level3",
    status: "online"
  });
});

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "level3-intelligence",
    timestamp: Date.now()
  });
});

// -----------------------------------------------------
// BROWSER SINGLETON (IMPORTANT UPGRADE)
// -----------------------------------------------------
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
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
  return browserInstance;
}

// -----------------------------------------------------
// SMART PAGE LOADER (ANTI-BLOCK LAYER)
// -----------------------------------------------------
async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    // retry with longer wait (EcoTrade sometimes delays hydration)
    await page.goto(url, { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(4000);
  }
}

// -----------------------------------------------------
// CORE SCRAPER
// -----------------------------------------------------
async function scrape(url) {
  let browser;

  try {
    browser = await getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9"
    });

    await page.setViewportSize({ width: 1366, height: 768 });

    await safeGoto(page, url);

    const result = await page.evaluate(() => {
      const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

      const text = clean(document.body.innerText);
      const title = clean(
        document.querySelector("h1")?.innerText ||
        document.querySelector("[class*='title']")?.innerText ||
        document.title
      );

      const isProduct = /\/product\//.test(location.href);

      const references = [...new Set(text.match(/\b\d{6,14}\b/g) || [])].slice(0, 30);

      const priceHints = [...new Set(text.match(/(\$\s?\d[\d\s,.]*)/g) || [])].slice(0, 10);

      const images = Array.from(document.images)
        .map(i => i.src)
        .filter(src =>
          src &&
          src.includes("ecotradegroup") &&
          !src.includes("flag") &&
          !src.includes("logo")
        )
        .slice(0, 12);

      // PRODUCT EXTRACTION
      const productDetails = {
        brand: text.match(/Brand\s+([A-Za-z0-9 ]+)/i)?.[1],
        maker: text.match(/Maker\s+([A-Za-z0-9 ]+)/i)?.[1],
        type: text.match(/Product Type\s+([A-Za-z0-9 +]+)/i)?.[1],
        ref: text.match(/Ref\s+([A-Za-z0-9 ]+)/i)?.[1],
        years: text.match(/Years\s+([0-9, ]+)/i)?.[1],
        carModels: text.match(/Car Models\s+([A-Za-z0-9 -]+)/i)?.[1]
      };

      return {
        type: isProduct ? "product" : "search",
        title,
        references,
        priceHints,
        images,
        productDetails,
        preview: text.slice(0, 1500)
      };
    });

    await page.close();

    return {
      ok: true,
      data: result,
      meta: {
        source: "ecotrade",
        reliability: result.references.length > 0 ? "high" : "fallback"
      }
    };

  } catch (err) {
    return {
      ok: false,
      error: err.message,
      meta: {
        source: "ecotrade",
        reliability: "failed"
      }
    };
  }
}

// -----------------------------------------------------
// ROUTE
// -----------------------------------------------------
app.post("/scrape-product", async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.json({ ok: false, error: "URL_REQUIRED" });
  }

  const result = await scrape(url);
  return res.json(result);
});

// -----------------------------------------------------
// GLOBAL SAFETY NET
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
  console.log(`🚀 Level 3 Intelligence API running on ${PORT}`);
});
