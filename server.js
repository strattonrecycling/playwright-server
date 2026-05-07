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
    version: "final-intelligent-scraper",
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
// PLAYWRIGHT RENDER
// -----------------------------
async function render(url) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    const html = await page.content();

    return html;
  } finally {
    if (browser) await browser.close();
  }
}

// -----------------------------
// MODE DETECTION
// -----------------------------
function getMode(url) {
  if (url.includes("/search?query=")) return "search";
  if (url.includes("/product/")) return "product";
  return "generic";
}

// -----------------------------
// SEARCH PARSER
// -----------------------------
function parseSearch(html, baseUrl) {
  const links = [...html.matchAll(/href="(\/en\/product\/[^"]+)"/g)];

  const results = links.map((m) => ({
    title: "Product",
    url: baseUrl + m[1]
  }));

  return {
    type: "search",
    results: results.slice(0, 10)
  };
}

// -----------------------------
// PRODUCT PARSER (SAFE)
// -----------------------------
function extractField(html, label) {
  const regex = new RegExp(`<th[^>]*>${label}<\/th>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\/td>`, "i");
  const match = html.match(regex);
  return match ? match[1].replace(/<[^>]*>/g, "").trim() : null;
}

// -----------------------------
// SCRAPE ENDPOINT
// -----------------------------
app.post("/scrape-product", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.json({ status: "error", message: "missing url" });

    const html = await render(url);
    const mode = getMode(url);

    // -----------------------------
    // SEARCH MODE
    // -----------------------------
    if (mode === "search") {
      return res.json(parseSearch(html, "https://www.ecotradegroup.com"));
    }

    // -----------------------------
    // PRODUCT MODE
    // -----------------------------
    const usdText = extractField(html, "Price");
    const usd = usdText ? parseFloat(usdText.replace(/[^0-9.]/g, "")) : 0;

    const rate = await getUsdToZar();

    return res.json({
      type: "product",
      url,
      brand: extractField(html, "Brand") || "Unknown",
      productType: extractField(html, "Product Type") || "Unknown",
      ref: extractField(html, "Ref") || "Unknown",
      years: extractField(html, "Years") || "Unknown",
      carModels: extractField(html, "Car Models") || "Unknown",
      price: {
        usd,
        zar: Math.round(usd * rate)
      }
    });

  } catch (err) {
    return res.json({
      status: "error",
      message: err.message
    });
  }
});

// -----------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Playwright server running on port", PORT);
});
