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
    version: "strict-json-v2",
    timestamp: Date.now()
  });
});

// -------------------------------------
// SAFE DELAY
// -------------------------------------
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// -------------------------------------
// PLAYWRIGHT CORE (SAFE)
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

    await delay(3000);

    const html = await page.content();

    return {
      ok: true,
      html: html || ""
    };

  } catch (err) {
    return {
      ok: false,
      error: err.message
    };

  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// -------------------------------------
// SAFE RESPONSE NORMALISER
// -------------------------------------
function safeResults(results) {
  if (!Array.isArray(results)) return [];
  return results;
}

// -------------------------------------
// SIMPLE PARSERS (NO HTML LEAKS)
// -------------------------------------
function extractSearch(html, url) {
  return {
    type: "search",
    query: url,
    results: safeResults([]),
    count: 0
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
// MAIN ENDPOINT (100% JSON SAFE)
// -------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(200).json({
        type: "error",
        message: "Missing URL"
      });
    }

    const result = await renderPage(url);

    if (!result.ok) {
      return res.status(200).json({
        type: "error",
        message: result.error
      });
    }

    const html = result.html || "";

    // IMPORTANT: NEVER RETURN HTML
    const isSearch = url.includes("search");

    if (isSearch) {
      const data = extractSearch(html, url);

      return res.status(200).json({
        ...data,
        results: safeResults(data.results)
      });
    }

    const product = extractProduct(html, url);

    return res.status(200).json(product);

  } catch (err) {
    return res.status(200).json({
      type: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// OPTIONAL RAW RENDER (DEBUG ONLY)
// -------------------------------------
app.post("/render", async (req, res) => {
  try {
    const { url } = req.body;

    const result = await renderPage(url);

    return res.status(200).json({
      ok: result.ok,
      error: result.error || null
    });

  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.message
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
