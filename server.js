const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// HARD JSON SAFETY
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "catalytic-intelligence-v4",
    uptime: process.uptime()
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    status: "ok",
    version: "v4-router-extractor",
    timestamp: Date.now()
  });
});

// -------------------------------------
// PLAYWRIGHT CORE
// -------------------------------------
async function loadPage(url) {
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

    await page.waitForTimeout(2500);

    return { ok: true, page };

  } catch (err) {
    return { ok: false, error: err.message };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// -------------------------------------
// SEARCH EXTRACTOR
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
        href.includes("/product/")
      ) {
        items.push({ title, url: href });
      }
    });

    return items;
  });

  return {
    type: "search",
    query: url,
    results: results.slice(0, 30),
    count: results.length
  };
}

// -------------------------------------
// PRODUCT EXTRACTOR (REAL STRUCTURE)
// -------------------------------------
async function extractProduct(page, url) {
  const data = await page.evaluate(() => {
    const text = document.body.innerText || "";

    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.title;

    // OEM / reference detection (6–10 digit codes)
    const refs = text.match(/\b\d{6,10}\b/g) || [];

    // try to find brand from breadcrumb or title
    const brandGuess =
      document.querySelector(".breadcrumb")?.innerText?.split("\n")[1] ||
      null;

    return {
      title,
      brand: brandGuess,
      references: [...new Set(refs)].slice(0, 15),
      preview: text.slice(0, 400)
    };
  });

  return {
    type: "product",
    url,
    ...data
  };
}

// -------------------------------------
// SAFE JSON WRAPPER
// -------------------------------------
function safe(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return {
      type: "error",
      message: "Serialization failure"
    };
  }
}

// -------------------------------------
// MAIN ROUTE (FIXED ROUTING LOGIC)
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

    const pageResult = await loadPage(url);

    if (!pageResult.ok) {
      return res.status(200).json({
        type: "error",
        message: pageResult.error
      });
    }

    const page = pageResult.page;

    let output;

    // STRICT ROUTING (THIS IS KEY FIX)
    if (url.includes("/product/")) {
      output = await extractProduct(page, url);
    } else if (url.includes("/search")) {
      output = await extractSearch(page, url);
    } else {
      output = {
        type: "unknown",
        message: "Unsupported page type"
      };
    }

    return res.status(200).json(safe(output));

  } catch (err) {
    return res.status(200).json({
      type: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// GLOBAL SAFETY NET
// -------------------------------------
app.use((err, req, res, next) => {
  return res.status(200).json({
    type: "error",
    message: err.message || "Server error"
  });
});

// -------------------------------------
// START
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Catalytic Intelligence v4 running on port", PORT);
});
