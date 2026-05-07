const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON RESPONSE HEADERS
// -------------------------------------
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// -------------------------------------
// GLOBAL HTML BLOCKER (CRITICAL FIX)
// -------------------------------------
app.use((req, res, next) => {
  const originalSend = res.send;

  res.send = function (body) {
    try {
      if (typeof body === "string" && body.trim().startsWith("<!DOCTYPE")) {
        return originalSend.call(this, JSON.stringify({
          ok: false,
          error: "HTML blocked at gateway layer",
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
    version: "locked-production-v4"
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

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

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
        structured = !!Array.from(document.scripts).find(s =>
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
// API ENDPOINT (HARDENED)
// -------------------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const url = req.body?.url;

    if (!url || typeof url !== "string") {
      return res.json({
        ok: false,
        error: "Missing or invalid URL"
      });
    }

    const result = await scrape(url);

    // FINAL SAFETY CHECK (NO HTML EVER)
    if (!result || typeof result !== "object") {
      return res.json({
        ok: false,
        error: "Invalid scraper response"
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
// START
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Locked Catalytic API running on port", PORT);
});
