const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------------------------------
// 🔒 GLOBAL JSON SAFETY LAYER (NO HTML EVER)
// -----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-SERVICE-VERSION", "ecotrade-locked-v4");
  next();
});

// -----------------------------------------------------
// HEALTH
// -----------------------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "catalytic-intelligence-level3",
    status: "online"
  });
});

// -----------------------------------------------------
// DEBUG
// -----------------------------------------------------
app.get("/debug", (req, res) => {
  res.status(200).json({
    success: true,
    version: "v4-production-locked",
    timestamp: Date.now()
  });
});

// -----------------------------------------------------
// BROWSER SINGLETON (PREVENT MEMORY LEAKS)
// -----------------------------------------------------
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });
  }
  return browser;
}

// -----------------------------------------------------
// SAFE NAVIGATION (ANTI TIMEOUT FIX)
// -----------------------------------------------------
async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    await page.goto(url, { waitUntil: "load", timeout: 90000 });
  }
}

// -----------------------------------------------------
// CORE SCRAPER
// -----------------------------------------------------
async function scrape(url) {
  let context;

  try {
    const browserInstance = await getBrowser();

    context = await browserInstance.newContext({
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
    // FINAL NORMALISED RESPONSE CONTRACT
    // -------------------------------------------------
    return {
      success: true,
      error: null,
      data,
      meta: {
        source: "ecotrade",
        version: "v4-production-locked",
        url
      }
    };

  } catch (err) {
    return {
      success: false,
      error: {
        code: "SCRAPER_FAILED",
        message: err.message
      },
      data: null,
      meta: {
        source: "ecotrade"
      }
    };
  }
}

// -----------------------------------------------------
// API ROUTE
// -----------------------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        success: false,
        error: {
          code: "URL_REQUIRED",
          message: "URL is required"
        },
        data: null
      });
    }

    const result = await scrape(url);

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: "FATAL_ERROR",
        message: err.message
      },
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
    error: {
      code: "UNHANDLED_EXCEPTION",
      message: err.message
    },
    data: null
  });
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 ECOTRADE LOCKED v4 running on port ${PORT}`);
});
