const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "10mb" }));

// -------------------------------------
// FORCE JSON RESPONSES
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
    version: "v7-dynamic-render-stable",
    timestamp: Date.now()
  });
});

// -------------------------------------
// SAFE PAGE NAVIGATION
// -------------------------------------
async function safeGoto(page, url) {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
  } catch {
    await page.goto(url, {
      waitUntil: "load",
      timeout: 60000
    });
  }

  // initial hydration wait
  await page.waitForTimeout(8000);

  // attempt network stabilization
  try {
    await page.waitForLoadState("networkidle", {
      timeout: 15000
    });
  } catch {}

  // scroll trigger
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch {}

  await page.waitForTimeout(3000);
}

// -------------------------------------
// SEARCH EXTRACTION
// -------------------------------------
async function extractSearch(page, url) {

  const results = await page.evaluate(() => {

    const items = [];

    // ---------------------------------
    // DIRECT PRODUCT LINKS
    // ---------------------------------
    document.querySelectorAll("a").forEach(a => {

      const href = a.href || "";
      const text = (a.innerText || "").trim();

      if (
        href.includes("/product/") &&
        text.length > 2
      ) {
        items.push({
          title: text.slice(0, 120),
          url: href
        });
      }
    });

    // ---------------------------------
    // SCRIPT JSON EXTRACTION
    // ---------------------------------
    const scripts = Array.from(
      document.querySelectorAll("script")
    );

    for (const script of scripts) {

      const txt = script.innerText || "";

      if (
        txt.includes("product") ||
        txt.includes("search") ||
        txt.includes("results")
      ) {

        // find product URLs inside raw JS
        const matches = txt.match(
          /https:\/\/www\.ecotradegroup\.com\/en\/product\/[^"'\\ ]+/g
        ) || [];

        matches.forEach(url => {
          items.push({
            title: "EcoTrade Product",
            url
          });
        });
      }
    }

    // ---------------------------------
    // DEDUPE
    // ---------------------------------
    const seen = new Set();

    return items.filter(item => {

      if (!item.url) return false;

      if (seen.has(item.url)) {
        return false;
      }

      seen.add(item.url);

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
      debug:
        results.length === 0
          ? "No product matches detected"
          : "Search extraction successful"
    }
  };
}

// -------------------------------------
// PRODUCT EXTRACTION
// -------------------------------------
async function extractProduct(page) {

  const data = await page.evaluate(() => {

    const bodyText =
      document.body?.innerText || "";

    // ---------------------------------
    // TITLE
    // ---------------------------------
    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.title ||
      "Unknown Product";

    // ---------------------------------
    // REFERENCES
    // ---------------------------------
    const references = [
      ...new Set(
        (
          bodyText.match(
            /\b[A-Z0-9\-]{5,20}\b/g
          ) || []
        )
      )
    ]
    .filter(x => /\d/.test(x))
    .slice(0, 50);

    // ---------------------------------
    // PRICE DETECTION
    // ---------------------------------
    const priceHints = [
      ...new Set(
        (
          bodyText.match(
            /(R\s?\d[\d\s,.]*)|(€\s?\d[\d\s,.]*)|(\$\s?\d[\d\s,.]*)/g
          ) || []
        )
      )
    ].slice(0, 20);

    // ---------------------------------
    // IMAGES
    // ---------------------------------
    const images = Array.from(document.images)
      .map(img => img.src)
      .filter(src =>
        src &&
        src.startsWith("http")
      )
      .slice(0, 15);

    // ---------------------------------
    // TEXT BLOCKS
    // ---------------------------------
    const paragraphs = Array.from(
      document.querySelectorAll("p, li, div")
    )
      .map(el => (el.innerText || "").trim())
      .filter(text =>
        text.length > 40 &&
        text.length < 500
      )
      .slice(0, 20);

    return {
      type: "product",
      title,
      references,
      priceHints,
      images,
      preview: bodyText.slice(0, 1500),
      paragraphs
    };
  });

  return {
    ok: true,
    data
  };
}

// -------------------------------------
// MAIN SCRAPER
// -------------------------------------
async function scrape(url) {

  let browser;

  try {

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process"
      ]
    });

    const context = await browser.newContext({
      viewport: {
        width: 1366,
        height: 768
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
    });

    const page = await context.newPage();

    // prevent image overload
    await page.route("**/*", route => {

      const type = route.request().resourceType();

      if (
        type === "font" ||
        type === "media"
      ) {
        return route.abort();
      }

      route.continue();
    });

    await safeGoto(page, url);

    // ---------------------------------
    // SEARCH MODE
    // ---------------------------------
    if (!url.includes("/product/")) {

      const result = await extractSearch(page, url);

      return result;
    }

    // ---------------------------------
    // PRODUCT MODE
    // ---------------------------------
    const result = await extractProduct(page);

    return result;

  } catch (err) {

    return {
      ok: false,
      error: err.message
    };

  } finally {

    if (browser) {
      try {
        await browser.close();
      } catch {}
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
// FALLBACK 404
// -------------------------------------
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found"
  });
});

// -------------------------------------
// START SERVER
// -------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    `Catalytic Intelligence API running on port ${PORT}`
  );
});
