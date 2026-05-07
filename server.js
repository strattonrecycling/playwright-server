const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "10mb" }));

// -----------------------------
// HEALTH
// -----------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "playwright-server",
    uptime: process.uptime()
  });
});

// -----------------------------
// DEBUG
// -----------------------------
app.get("/debug", (req, res) => {
  res.json({
    status: "debug-ok",
    version: "locator-extraction-v2",
    timestamp: Date.now()
  });
});

// -----------------------------
// USD → ZAR CACHE (15 MIN)
// -----------------------------
let cachedRate = null;
let lastFetch = 0;

async function getUsdToZar() {
  const now = Date.now();

  if (cachedRate && now - lastFetch < 15 * 60 * 1000) {
    return cachedRate;
  }

  try {
    const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=ZAR");
    const data = await res.json();

    cachedRate = data?.rates?.ZAR || 18;
    lastFetch = now;

    return cachedRate;
  } catch {
    return 18;
  }
}

// -----------------------------
// PLAYWRIGHT SCRAPER CORE
// -----------------------------
async function scrape(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 🔥 CRITICAL: allow JS-rendered content to load
    await page.waitForTimeout(6000);

    return { page, browser };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// -----------------------------
// SEARCH MODE (FIXED - RELIABLE)
// -----------------------------
async function scrapeSearch(page) {
  // 🔥 wait for ANY links (EcoTrade is JS-heavy)
  await page.waitForTimeout(3000);

  const results = await page.locator("a").evaluateAll((anchors) => {
    return anchors
      .map(a => ({
        href: a.getAttribute("href") || "",
        text: a.innerText || ""
      }))
      .filter(a =>
        a.href.includes("/product/") &&
        a.text.trim().length > 2
      )
      .map(a => ({
        title: a.text.trim(),
        url: a.href.startsWith("http")
          ? a.href
          : "https://www.ecotradegroup.com" + a.href
      }))
      .slice(0, 10);
  });

  return {
    type: "search",
    results
  };
}

// -----------------------------
// PRODUCT MODE (SAFE EXTRACTION)
// -----------------------------
async function scrapeProduct(page) {
  const getText = async (label) => {
    try {
      return await page.locator(`text=${label}`).first().textContent();
    } catch {
      return null;
    }
  };

  const priceText = await getText("Price");
  const usd = parseFloat((priceText || "").replace(/[^0-9.]/g, "")) || 0;

  const rate = await getUsdToZar();

  return {
    type: "product",
    brand: await getText("Brand") || "Unknown",
    productType: await getText("Product Type") || "Unknown",
    ref: await getText("Ref") || "Unknown",
    years: await getText("Years") || "Unknown",
    carModels: await getText("Car Models") || "Unknown",
    price: {
      usd,
      zar: Math.round(usd * rate)
    }
  };
}

// -----------------------------
// MAIN ENDPOINT
// -----------------------------
app.post("/scrape-product", async (req, res) => {
  let browser;

  try {
    const { url } = req.body;
    if (!url) {
      return res.json({ status: "error", message: "missing url" });
    }

    const mode = url.includes("/search?query=")
      ? "search"
      : url.includes("/product/")
      ? "product"
      : "generic";

    const { page, browser: b } = await scrape(url);
    browser = b;

    let result;

    if (mode === "search") {
      result = await scrapeSearch(page);
    } else {
      result = await scrapeProduct(page);
    }

    return res.json(result);

  } catch (err) {
    return res.json({
      status: "error",
      message: err.message
    });

  } finally {
    if (browser) await browser.close();
  }
});

// -----------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Playwright server running on port", PORT);
});
