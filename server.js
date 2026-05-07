const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -----------------------------------
// HEALTH
// -----------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "playwright-server",
    uptime: process.uptime()
  });
});

// -----------------------------------
// SAFE DELAY
// -----------------------------------
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -----------------------------------
// CORE RENDER FUNCTION
// -----------------------------------
async function renderPage(url) {
  let browser;

  try {
    console.log("Launching Chromium...");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    console.log("Creating page...");

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    const page = await context.newPage();

    console.log("Opening URL:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    // allow JS rendering
    await delay(5000);

    // scroll once
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await delay(2000);

    console.log("Extracting HTML...");

    const html = await page.content();

    console.log("HTML length:", html.length);

    await browser.close();

    return {
      success: true,
      html
    };

  } catch (err) {
    console.error("PLAYWRIGHT ERROR:", err);

    try {
      if (browser) {
        await browser.close();
      }
    } catch (e) {}

    return {
      success: false,
      error: err.message,
      stack: err.stack
    };
  }
}

// -----------------------------------
// /render
// -----------------------------------
app.post("/render", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "Missing url"
      });
    }

    const result = await renderPage(url);

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error,
        stack: result.stack
      });
    }

    return res.json({
      status: "success",
      url,
      html: result.html
    });

  } catch (err) {
    return res.status(500).json({
      status: "fatal",
      message: err.message
    });
  }
});

// -----------------------------------
// /scrape-product
// -----------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "Missing url"
      });
    }

    const result = await renderPage(url);

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error,
        stack: result.stack
      });
    }

    return res.json({
      status: "success",
      url,
      html: result.html
    });

  } catch (err) {
    return res.status(500).json({
      status: "fatal",
      message: err.message
    });
  }
});

// -----------------------------------
// START SERVER
// -----------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
