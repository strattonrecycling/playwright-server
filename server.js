const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------------------------------
// FORCE JSON MODE (PREVENT ANY HTML RESPONSES)
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
    success: true,
    service: "catalytic-intelligence-level3",
    status: "online"
  });
});

// -----------------------------------------------------
// DEBUG
// -----------------------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    success: true,
    version: "v5-hardened-no-html-leaks",
    timestamp: Date.now()
  });
});

// -----------------------------------------------------
// BROWSER SINGLETON
// -----------------------------------------------------
let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
  return browser;
}

// -----------------------------------------------------
// SAFE NAVIGATION (CRITICAL FIX)
// -----------------------------------------------------
async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (err) {
    // fallback attempt (NEVER throw)
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
  }
}

// -----------------------------------------------------
// SCRAPER (FULLY PROTECTED)
// -----------------------------------------------------
async function scrape(url) {
  let context;

  try {
    const browser = await getBrowser();

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    });

    const page = await context.newPage();

    await safeGoto(page, url);

    const data = await page.evaluate(() => {
      const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

      const title = clean(document.querySelector("h1")?.innerText || document.title);
      const text = clean(document.body.innerText || "");

      const isProduct = location.href.includes("/product/");

      const references = [...new Set(text.match(/\b\d{6,14}\b/g) || [])].slice(0, 30);
      const priceHints = [...new Set(text.match(/\$\s?\d[\d\s,.]*/g) || [])].slice(0, 10);

      const images = Array.from(document.images || [])
        .map(i => i.src)
        .filter(Boolean)
        .slice(0, 15);

      return {
        type: isProduct ? "product" : "search",
        title,
        references,
        priceHints,
        images,
        preview: text.slice(0, 1200)
      };
    });

    await context.close();

    return {
      success: true,
      error: null,
      data
    };

  } catch (err) {
    // NEVER ALLOW HTML OR RAW ERRORS OUTSIDE JSON
    try {
      if (context) await context.close();
    } catch {}

    return {
      success: false,
      error: {
        code: "SCRAPE_FAILED",
        message: err.message
      },
      data: null
    };
  }
}

// -----------------------------------------------------
// API ROUTE (ABSOLUTE JSON SAFETY)
// -----------------------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.json({
        success: false,
        error: { code: "URL_REQUIRED", message: "URL is required" },
        data: null
      });
    }

    const result = await scrape(url);

    return res.json(result);

  } catch (err) {
    // FINAL SAFETY NET (NO HTML EVER)
    return res.json({
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
// GLOBAL SAFETY NET (CRITICAL)
// -----------------------------------------------------
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// -----------------------------------------------------
// START
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 v5 hardened scraper running on port", PORT);
});
