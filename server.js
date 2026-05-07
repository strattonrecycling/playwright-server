const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON RESPONSES ONLY
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// -------------------------------------
// GLOBAL SAFETY NET (NO HTML LEAKS)
// -------------------------------------
app.use((req, res, next) => {
  const originalSend = res.send;

  res.send = function (body) {
    try {
      if (typeof body === "string" && body.trim().startsWith("<!DOCTYPE")) {
        return originalSend.call(this, JSON.stringify({
          ok: false,
          error: "HTML blocked at gateway",
          hint: "invalid route or crash response"
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
    version: "v6-js-state-extraction"
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
    // NAVIGATION (STABLE MODE)
    // -------------------------------------
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
    } catch {
      await page.goto(url, {
        waitUntil: "load",
        timeout: 45000
      });
    }

    await page.waitForTimeout(5000);

    // -------------------------------------
    // SEARCH MODE (IMPROVED JS STATE EXTRACTION)
    // -------------------------------------
    if (!url.includes("/product/")) {

      const results = await page.evaluate(() => {
        const items = [];

        // 1. Try DOM links first
        document.querySelectorAll("a").forEach(a => {
          const text = (a.innerText || "").trim();
          const href = a.href || "";

          if (href.includes("/product/") && text.length > 5) {
            items.push({
              title: text.slice(0, 120),
              url: href
            });
          }
        });

        // 2. Try script JSON extraction (React/Vue state)
        const scripts = Array.from(document.querySelectorAll("script"));

        for (const s of scripts) {
          const txt = s.innerText || "";

          if (
            txt.includes("product") ||
            txt.includes("results") ||
            txt.includes("search")
          ) {
            try {
              const match = txt.match(/\{.*\}/s);
              if (!match) continue;

              const json = JSON.parse(match[0]);

              const possible =
                json?.props?.pageProps?.results ||
                json?.results ||
                json?.data ||
                [];

              if (Array.isArray(possible)) {
                possible.forEach(p => {
                  if (p?.url || p?.link) {
                    items.push({
                      title: p.title || p.name || "product",
                      url: p.url || p.link
                    });
                  }
                });
              }

            } catch {}
          }
        }

        // dedupe
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
          count: results.length,
          debug: results.length === 0
            ? "no DOM or JS-state matches found"
            : "ok"
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

      const references = text.match(/\b\d{6,10}\b/g) || [];
      const priceHints = text.match(/R\s?\d+|€\s?\d+|\$\s?\d+/g) || [];

      return {
        type: "product",
        title,
        references: [...new Set(references)].slice(0, 25),
        priceHints: [...new Set(priceHints)].slice(0, 10),
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
