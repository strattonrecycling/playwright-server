const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON SAFETY (BASE44 FIX)
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
    status: "running"
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "production-v3-final"
  });
});

// -------------------------------------
// CORE SCRAPER
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

    // -------------------------------------
    // NAVIGATION (ROBUST)
    // -------------------------------------
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    // DOM hydration buffer (EcoTrade needs this)
    await page.waitForTimeout(5000);

    // -------------------------------------
    // SEARCH MODE
    // -------------------------------------
    if (!url.includes("/product/")) {
      const results = await page.evaluate(() => {
        const items = [];

        const selectors = [
          "a",
          "article a",
          "div a",
          "li a"
        ];

        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(a => {
            const text = (a.innerText || "").trim();
            const href = a.href || "";

            if (
              text.length > 8 &&
              href.includes("/product/")
            ) {
              items.push({
                title: text.slice(0, 120),
                url: href
              });
            }
          });
        });

        // deduplicate
        const unique = [];
        const seen = new Set();

        for (const r of items) {
          if (!seen.has(r.url)) {
            seen.add(r.url);
            unique.push(r);
          }
        }

        return unique.slice(0, 30);
      });

      return {
        ok: true,
        data: {
          type: "search",
          query: url,
          results,
          count: results.length
        }
      };
    }

    // -------------------------------------
    // PRODUCT MODE
    // -------------------------------------
    const product = await page.evaluate(() => {
      const text = document.body.innerText || "";

      const title =
        document.querySelector("h1")?.innerText?.trim() ||
        document.title;

      const refs = text.match(/\b\d{6,10}\b/g) || [];

      let jsonHint = null;

      try {
        const scripts = Array.from(document.querySelectorAll("script"));

        for (const s of scripts) {
          const t = s.innerText || "";
          if (
            t.includes("product") ||
            t.includes("sku") ||
            t.includes("reference")
          ) {
            jsonHint = t.slice(0, 300);
            break;
          }
        }
      } catch {}

      const priceHints = text.match(/€\s?\d+|\$\s?\d+|R\s?\d+/g) || [];

      return {
        type: "product",
        title,
        references: [...new Set(refs)].slice(0, 25),
        priceHints: [...new Set(priceHints)].slice(0, 10),
        structuredDetected: !!jsonHint,
        preview: text.slice(0, 600)
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
// START
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Catalytic Intelligence API running on port", PORT);
});
