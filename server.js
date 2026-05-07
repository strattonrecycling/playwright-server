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
    service: "catalytic-intelligence-api",
    uptime: process.uptime()
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    status: "ok",
    version: "catalytic-intelligence-v1",
    timestamp: Date.now()
  });
});

// -------------------------------------
// PLAYWRIGHT CORE
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

    await page.waitForTimeout(3000);

    return { ok: true, page };

  } catch (err) {
    return { ok: false, error: err.message };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// -------------------------------------
// SEARCH EXTRACTION (REAL)
// -------------------------------------
async function extractSearch(page, url) {
  const results = await page.evaluate(() => {
    const items = [];

    document.querySelectorAll("a").forEach(a => {
      const text = a.innerText?.trim();
      const href = a.href;

      if (text && href && text.length > 8 && href.includes("ecotradegroup")) {
        items.push({
          title: text,
          url: href
        });
      }
    });

    return items;
  });

  return {
    type: "search",
    query: url,
    results: results.slice(0, 25),
    count: results.length
  };
}

// -------------------------------------
// PRODUCT EXTRACTION (REAL)
// -------------------------------------
async function extractProduct(page, url) {
  const data = await page.evaluate(() => {
    const text = document.body.innerText;

    // Try to detect reference numbers (OEM / cat codes)
    const refMatch = text.match(/\b\d{6,10}\b/g);

    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.title;

    return {
      title,
      reference: refMatch ? refMatch[0] : null,
      rawPreview: text.slice(0, 300)
    };
  });

  return {
    type: "product",
    url,
    ...data
  };
}

// -------------------------------------
// MAIN ENDPOINT
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

    if (isSearch) {
      const data = await extractSearch(page, url);
      return res.status(200).json(data);
    }

    const product = await extractProduct(page, url);
    return res.status(200).json(product);

  } catch (err) {
    return res.status(200).json({
      type: "error",
      message: err.message
    });
  }
});

// -------------------------------------
// START
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Catalytic Intelligence API running on port", PORT);
});
