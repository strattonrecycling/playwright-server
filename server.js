const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "playwright-server",
    status: "running"
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "base44-stable-v1"
  });
});

// -------------------------------------
// CORE BROWSER FUNCTION
// -------------------------------------
async function loadPage(url) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

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
  return await page.evaluate(() => {
    const results = [];

    document.querySelectorAll("a").forEach(a => {
      const text = a.innerText?.trim();
      const href = a.href;

      if (
        text &&
        href &&
        href.includes("/product/")
      ) {
        results.push({
          title: text,
          url: href
        });
      }
    });

    return results;
  }).then(results => ({
    type: "search",
    query: url,
    results: results.slice(0, 25),
    count: results.length
  }));
}

// -------------------------------------
// PRODUCT EXTRACTOR
// -------------------------------------
async function extractProduct(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText || "";

    const refs = text.match(/\b\d{6,10}\b/g) || [];

    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.title;

    return {
      type: "product",
      title,
      references: [...new Set(refs)].slice(0, 15),
      preview: text.slice(0, 250)
    };
  });
}

// -------------------------------------
// MAIN ROUTE (STRICT CONTRACT)
// -------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.json({
        ok: false,
        error: "Missing URL"
      });
    }

    const result = await loadPage(url);

    if (!result.ok) {
      return res.json({
        ok: false,
        error: result.error
      });
    }

    const page = result.page;

    let output;

    // ROUTING LOGIC
    if (url.includes("/product/")) {
      output = await extractProduct(page);
    } else {
      output = await extractSearch(page, url);
    }

    // -------------------------------------
    // FINAL WRAPPER (BASE44 SAFE CONTRACT)
    // -------------------------------------
    return res.json({
      ok: true,
      data: output
    });

  } catch (err) {
    return res.json({
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
  console.log("Base44 Stable Scraper running on port", PORT);
});
