const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON SAFETY (CRITICAL FOR BASE44)
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "catalytic-intelligence-api",
    status: "healthy"
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "production-v1"
  });
});

// -------------------------------------
// SAFE SCRAPE CORE
// -------------------------------------
async function scrape(url) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--single-process"
      ]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3500);

    // ---------------------------------
    // SEARCH MODE
    // ---------------------------------
    if (!url.includes("/product/")) {
      const results = await page.evaluate(() => {
        const items = [];

        document.querySelectorAll("a").forEach(a => {
          const text = (a.innerText || "").trim();
          const href = a.href;

          if (
            text &&
            href &&
            href.includes("/product/")
          ) {
            items.push({ title: text, url: href });
          }
        });

        return items;
      });

      return {
        ok: true,
        data: {
          type: "search",
          query: url,
          results: results.slice(0, 25),
          count: results.length
        }
      };
    }

    // ---------------------------------
    // PRODUCT MODE
    // ---------------------------------
    const product = await page.evaluate(() => {
      const text = document.body.innerText || "";

      const refs = text.match(/\b\d{6,10}\b/g) || [];

      const title =
        document.querySelector("h1")?.innerText?.trim() ||
        document.title;

      return {
        type: "product",
        title,
        references: [...new Set(refs)].slice(0, 15),
        preview: text.slice(0, 300)
      };
    });

    return {
      ok: true,
      data: product
    };

  } catch (err) {
    return {
      ok: false,
      error: err.message
    };

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// -------------------------------------
// API ENDPOINT
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

    const result = await scrape(url);

    return res.json(result);

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
  console.log("PRODUCTION SCRAPER RUNNING ON", PORT);
});
