const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "playwright-server",
    uptime: process.uptime()
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    status: "ok",
    version: "stable-json-api",
    timestamp: Date.now()
  });
});

// -------------------------------------
// SAFE DELAY
// -------------------------------------
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// -------------------------------------
// PLAYWRIGHT CORE
// -------------------------------------
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

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await delay(4000);

    const html = await page.content();

    return { ok: true, html };

  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// -------------------------------------
// SIMPLE HTML PARSERS (SAFE FALLBACKS)
// -------------------------------------
function extractSearch(html, url) {
  // Basic safe fallback (prevents crashes)
  return {
    type: "search",
    query: url,
    results: []
  };
}

function extractProduct(html, url) {
  return {
    type: "product",
    url,
    title: null,
    reference: null,
    brand: null,
    price: null
  };
}

// -------------------------------------
// SCRAPE ENDPOINT (BASE44 SAFE)
// -------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(200).json({
        status: "error",
        message: "Missing URL"
      });
    }

    const result = await renderPage(url);

    if (!result.ok) {
      return res.status(200).json({
        status: "error",
        message: result.error
      });
    }

    const html = result.html || "";

    const isSearch = url.includes("search");

    if (isSearch) {
      return res.status(200).json(extractSearch(html, url));
    }

    return res.status(200).json(extractProduct(html, url));

  } catch (err) {
    return res.status(200).json({
      status: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// RENDER ENDPOINT (OPTIONAL)
// -------------------------------------
app.post("/render", async (req, res) => {
  try {
    const { url } = req.body;
    const result = await renderPage(url);

    return res.status(200).json(result);

  } catch (err) {
    return res.status(200).json({
      status: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// START SERVER
// -------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Playwright server running on port", PORT);
});
