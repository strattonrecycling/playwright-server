const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON OUTPUT ONLY
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// -------------------------------------
// GLOBAL HTML BLOCKER
// -------------------------------------
app.use((req, res, next) => {
  const originalSend = res.send;

  res.send = function (body) {
    try {
      if (typeof body === "string" && body.trim().startsWith("<!DOCTYPE")) {
        return originalSend.call(this, JSON.stringify({
          ok: false,
          error: "HTML response blocked",
          hint: "invalid route or upstream crash"
        }));
      }
    } catch {}

    return originalSend.call(this, body);
  };

  next();
});

// -------------------------------------
// HEALTH
// -------------------------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "catalytic-intelligence-api",
    status: "online"
  });
});

// -------------------------------------
// DEBUG
// -------------------------------------
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "v5-timeout-fixed"
  });
});

// -------------------------------------
// SCRAPER CORE
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
    // FIXED NAVIGATION (NO NETWORKIDLE)
    // -------------------------------------
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
    } catch (err) {
      // fallback strategy (important for EcoTrade)
      await page.goto(url, {
        waitUntil: "load",
        timeout: 45000
      });
    }

    // IMPORTANT: hydration buffer
    await page.waitForTimeout(4000);

    // -------------------------------------
    // SEARCH MODE
    // -------------------------------------
    if (!url.includes("/product/")) {
      const results = await page.evaluate(() => {
        const items = [];

        document.querySelectorAll("a").forEach(a => {
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

        const seen = new Set();
        return items.filter(i => {
          if (seen.has(i.url)) return false;
          seen.add(i.url);
          return true;
        });
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

      const priceHints = text.match(/R\s?\d+|€\s?\d+|\$\s?\d+/g) || [];

      let structured = false;

      try {
        structured = Array.from(document.scripts).some(s =>
          (s.innerText || "").includes("sku") ||
          (s.innerText || "").includes("product")
        );
      } catch {}

      return {
        type: "product",
        title,
        references: [...new Set(refs)].slice(0, 25),
        priceHints: [...new Set(priceHints)].slice(0, 10),
        structured,
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
    const url = req.body?.url;

    if (!url) {
      return res.json({
        ok: false,
        error: "Missing URL"
      });
    }

    const result = await scrape(url);

    if (!result || typeof result !== "object") {
      return res.json({
        ok: false,
        error: "Invalid response from scraper"
      });
    }

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
  console.log("Catalytic Intelligence API running on port", PORT);
});
