const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// ----------------------
// HEALTH
// ----------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "playwright-server",
    uptime: process.uptime()
  });
});

// ----------------------
// CORE RENDER FUNCTION
// ----------------------
async function renderPage(url) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    });

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    // Allow JS rendering
    await page.waitForTimeout(3000);

    // Trigger lazy-loaded content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(1500);

    const html = await page.content();

    await browser.close();

    return {
      success: true,
      html
    };

  } catch (err) {
    if (browser) await browser.close();

    return {
      success: false,
      error: err.message
    };
  }
}

// ----------------------
// /render
// ----------------------
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
        message: result.error
      });
    }

    return res.json({
      status: "success",
      url,
      html: result.html
    });

  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

// ----------------------
// /scrape-product
// COMPATIBILITY ROUTE
// ----------------------
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
        message: result.error
      });
    }

    return res.json({
      status: "success",
      url,
      html: result.html
    });

  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

// ----------------------
// START SERVER
// ----------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
