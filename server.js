const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// HEALTH CHECK
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "playwright-server",
    uptime: process.uptime()
  });
});

// -------------------------------------
// DEBUG ROUTE (DEPLOYMENT VERIFICATION)
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    status: "debug-ok",
    version: "final-stable",
    timestamp: Date.now()
  });
});

// -------------------------------------
// SAFE DELAY UTILITY
// -------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------
// CORE RENDER FUNCTION (STABLE MODE)
// -------------------------------------
async function renderPage(url) {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      viewport: { width: 1366, height: 768 }
    });

    const page = await context.newPage();

    // -------------------------------------
    // SAFE NAVIGATION (NO NETWORKIDLE)
    // -------------------------------------
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });
    } catch (err) {
      // fallback retry
      await page.goto(url, { timeout: 60000 });
    }

    // -------------------------------------
    // STABLE RENDER WAIT
    // -------------------------------------
    await delay(8000);

    try {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
    } catch {}

    await delay(3000);

    // -------------------------------------
    // SAFE HTML EXTRACTION
    // -------------------------------------
    let html = "";

    try {
      html = await page.content();
    } catch (err) {
      return {
        success: false,
        error: "Failed to extract HTML",
        details: err.message
      };
    }

    return {
      success: true,
      html
    };

  } catch (err) {
    return {
      success: false,
      error: err.message,
      stack: err.stack
    };

  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

// -------------------------------------
// SCRAPE ENDPOINT (ZERO-500 GUARANTEE)
// -------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(200).json({
        status: "error",
        error: "Missing URL",
        html: null
      });
    }

    const result = await renderPage(url);

    if (!result.success) {
      return res.status(200).json({
        status: "error",
        url,
        error: result.error,
        details: result.details || null,
        html: null
      });
    }

    return res.status(200).json({
      status: "success",
      url,
      html: result.html
    });

  } catch (err) {
    // absolute safety net
    return res.status(200).json({
      status: "fatal-error",
      error: err.message,
      html: null
    });
  }
});

// -------------------------------------
// OPTIONAL RENDER ENDPOINT
// -------------------------------------
app.post("/render", async (req, res) => {
  try {
    const { url } = req.body;

    const result = await renderPage(url);

    return res.status(200).json(result);

  } catch (err) {
    return res.status(200).json({
      status: "error",
      error: err.message
    });
  }
});

// -------------------------------------
// GLOBAL SAFETY NETS
// -------------------------------------
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

// -------------------------------------
// START SERVER
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
