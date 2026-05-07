const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------------------------------
// 🔒 FORCE JSON ONLY (GLOBAL SAFETY LOCK)
// -----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-API-VERSION", "locked-v2");
  next();
});

// -----------------------------------------------------
// HEALTH
// -----------------------------------------------------
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "catalytic-intelligence-level3",
    status: "online"
  });
});

app.get("/debug", (req, res) => {
  return res.status(200).json({
    success: true,
    version: "locked-v2",
    timestamp: Date.now()
  });
});

// -----------------------------------------------------
// BROWSER SINGLETON (STABLE)
// -----------------------------------------------------
let browserInstance;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
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
// SAFE NAVIGATION
// -----------------------------------------------------
async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    await page.goto(url, { waitUntil: "load", timeout: 90000 });
  }
}

// -----------------------------------------------------
// CORE SCRAPER (HARDENED)
// -----------------------------------------------------
async function scrape(url) {
  let browser;
  let context;

  try {
    browser = await getBrowser();

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      viewport: { width: 1366, height: 768 }
    });

    const page = await context.newPage();

    await safeGoto(page, url);

    const data = await page.evaluate(() => {
      const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

      const text = clean(document.body.innerText);
      const title = clean(document.querySelector("h1")?.innerText || document.title);

      const isProduct = location.href.includes("/product/");

      const references = [...new Set(text.match(/\b\d{6,14}\b/g) || [])].slice(0, 30);

      const priceHints = [...new Set(text.match(/(\$\s?\d[\d\s,.]*)/g) || [])].slice(0, 10);

      const images = Array.from(document.images)
        .map(i => i.src)
        .filter(src => src && src.includes("ecotradegroup"))
        .slice(0, 12);

      return {
        type: isProduct ? "product" : "search",
        title,
        references,
        priceHints,
        images,
        preview: text.slice(0, 1500)
      };
    });

    await context.close();

    // -------------------------------------------------
    // STRICT RESPONSE FORMAT (NO VARIATION EVER)
    // -------------------------------------------------
    return {
      success: true,
      error: null,
      data,
      meta: {
        source: "ecotrade",
        version: "locked-v2"
      }
    };

  } catch (err) {
    return {
      success: false,
      error: {
        message: err.message,
        code: "SCRAPER_FAILED"
      },
      data: null,
      meta: {
        source: "ecotrade"
      }
    };
  }
}

// -----------------------------------------------------
// API ROUTE (100% SAFE CONTRACT)
// -----------------------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        success: false,
        error: { message: "URL_REQUIRED", code: "VALIDATION_ERROR" },
        data: null
      });
    }

    const result = await scrape(url);

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: err.message, code: "FATAL_ERROR" },
      data: null
    });
  }
});

// -----------------------------------------------------
// GLOBAL SAFETY NET (NO HTML EVER)
// -----------------------------------------------------
app.use((err, req, res, next) => {
  return res.status(500).json({
    success: false,
    error: { message: err.message, code: "UNHANDLED_EXCEPTION" },
    data: null
  });
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 LOCKED API v2 running on port ${PORT}`);
});
