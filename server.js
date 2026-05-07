const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON SAFETY (CRITICAL)
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "ok",
    service: "playwright-server-hardened",
    uptime: process.uptime()
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  return res.status(200).json({
    status: "ok",
    version: "hardened-v3",
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
async function fetchPage(url) {
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

    await delay(2500);

    return { ok: true, page };

  } catch (err) {
    return { ok: false, error: err.message };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// -------------------------------------
// SAFE ARRAY GUARD
// -------------------------------------
const safeArray = (arr) => Array.isArray(arr) ? arr : [];

// -------------------------------------
// SEARCH EXTRACTION
// -------------------------------------
async function extractSearch(page, url) {
  const results = await page.evaluate(() => {
    const items = [];

    document.querySelectorAll("a").forEach(a => {
      const title = a.innerText?.trim();
      const href = a.href;

      if (
        title &&
        href &&
        title.length > 6 &&
        href.includes("ecotradegroup")
      ) {
        items.push({ title, url: href });
      }
    });

    return items;
  });

  return {
    type: "search",
    query: url,
    results: safeArray(results).slice(0, 30),
    count: safeArray(results).length
  };
}

// -------------------------------------
// PRODUCT EXTRACTION
// -------------------------------------
async function extractProduct(page, url) {
  const data = await page.evaluate(() => {
    const text = document.body.innerText || "";

    const refs = text.match(/\b\d{6,10}\b/g);

    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.title ||
      null;

    return {
      title,
      reference: refs ? refs[0] : null,
      preview: text.slice(0, 300)
    };
  });

  return {
    type: "product",
    url,
    ...data
  };
}

// -------------------------------------
// HARD GUARANTEED SAFE RESPONSE WRAPPER
// -------------------------------------
function safeJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return {
      type: "error",
      message: "Serialization error"
    };
  }
}

// -------------------------------------
// MAIN ENDPOINT (NO HTML EVER)
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

    const result = await fetchPage(url);

    if (!result.ok) {
      return res.status(200).json({
        type: "error",
        message: result.error
      });
    }

    const page = result.page;
    const isSearch = url.includes("search");

    let output;

    if (isSearch) {
      output = await extractSearch(page, url);
    } else {
      output = await extractProduct(page, url);
    }

    return res.status(200).json(safeJson(output));

  } catch (err) {
    return res.status(200).json({
      type: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// GLOBAL SAFETY NET (CATCH EVERYTHING)
// -------------------------------------
app.use((err, req, res, next) => {
  return res.status(200).json({
    type: "error",
    message: err.message || "Unknown server error"
  });
});

// -------------------------------------
// START SERVER
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Hardened Playwright server running on port", PORT);
});
