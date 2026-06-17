server/server.js:

const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "50mb" }));

process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err.message));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));

const ECOTRADE_EMAIL = process.env.ECOTRADE_EMAIL || "";
const ECOTRADE_PASSWORD = process.env.ECOTRADE_PASSWORD || "";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── In-memory manual login sessions ──────────────────────────────────────────
const manualSessions = new Map();

// Auto-expire sessions after 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of manualSessions.entries()) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      console.log(`[ManualLogin] Expiring session ${id}`);
      session.browser.close().catch(() => {});
      manualSessions.delete(id);
    }
  }
}, 60 * 1000);

// =====================================================
// VERIFY SUBSCRIPTION ACCESS
// =====================================================
async function verifySubscriptionAccess(page) {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll("tr");
    let priceVisible = false;

    for (const row of rows) {
      const th = row.querySelector("th");
      const td = row.querySelector("td");
      if (!th || !td) continue;
      const key = (th.innerText || "").toLowerCase().trim();
      if (key === "price") {
        const tdText = (td.innerText || td.textContent || "").replace(/\u00a0/g, " ").trim();
        priceVisible = /R\s*[\d]/.test(tdText) || /\$\s*[\d]/.test(tdText) || /[\d]{2,}/.test(tdText);
        break;
      }
    }

    const bodyText = (document.body.innerText || "").toLowerCase();
    const isLoginWall = /you need to (log in|sign in)/i.test(bodyText) || /please (log in|sign in)/i.test(bodyText);
    const hasUpgradeWall = /upgrade your (plan|subscription)/i.test(bodyText) && !/price/i.test(bodyText);
    const hasProductTable = document.querySelectorAll("tr th").length > 3;
    const accessValid = priceVisible || (hasProductTable && !isLoginWall && !hasUpgradeWall);

    return { priceVisible, isLoginWall, hasUpgradeWall, accessValid };
  });
}

// =====================================================
// EXTRACT PRODUCT DATA
// =====================================================
async function extractProductData(page) {
  const debugInfo = await page.evaluate(() => {
    const bodyText = (document.body.innerText || "").substring(0, 2000);
    const hasPrice = /R[\s\d]|\$[\s\d]/.test(bodyText);
    const hasPGM = /platinum|palladium|rhodium/i.test(bodyText);
    const hasCode = /\b[A-Z]{1,3}\d{1,4}[A-Z0-9]*\b/.test(bodyText);
    const hasCurrency = /R\s?[0-9,]+|\$\s?[0-9,]+/.test(bodyText);
    const renderValid = hasPrice || hasPGM || hasCode || hasCurrency;
    return { title: document.title, hasPrice, hasPGM, hasCode, hasTable: document.querySelectorAll("tr th").length > 0, renderValid, bodyText };
  });

  console.log(`[Extract] title="${debugInfo.title}" hasTable=${debugInfo.hasTable} hasPrice=${debugInfo.hasPrice} renderValid=${debugInfo.renderValid}`);

  if (!debugInfo.renderValid) {
    console.log("[Extract] Render failed. Text sample:\n" + debugInfo.bodyText);
    return { type: "error", error: "Page loaded but no converter data found" };
  }

  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));

  return await page.evaluate(() => {
    const result = {
      type: "product", code: "", brand: "", model: null, years: null,
      product_type: "Ceramic", has_platinum: false, has_palladium: false, has_rhodium: false,
      price_usd: null, price_zar: null, image_urls: [], image_url: null, notes: null,
    };

    const cleanText = (el) => el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";

    const tableMap = {};
    document.querySelectorAll("tr").forEach(row => {
      const th = row.querySelector("th");
      const td = row.querySelector("td");
      if (th && td) tableMap[cleanText(th).toLowerCase()] = td;
    });

    const dlMap = {};
    document.querySelectorAll("dl, .product-specs, .specs, .details").forEach(dl => {
      const dts = dl.querySelectorAll("dt, .label, .key");
      const dds = dl.querySelectorAll("dd, .value");
      dts.forEach((dt, i) => { if (dds[i]) dlMap[cleanText(dt).toLowerCase()] = dds[i]; });
    });

    function lookup(keys) {
      for (const key of keys) {
        if (tableMap[key]) return cleanText(tableMap[key]);
        if (dlMap[key]) return cleanText(dlMap[key]);
      }
      return "";
    }
    function lookupEl(keys) {
      for (const key of keys) {
        if (tableMap[key]) return tableMap[key];
        if (dlMap[key]) return dlMap[key];
      }
      return null;
    }

    result.brand = lookup(["brand", "make", "manufacturer"]);
    result.code  = lookup(["ref", "reference", "code", "part number", "part no", "oem"]);
    const ptRaw = lookup(["product type", "type", "category"]);
    result.product_type = ["Ceramic","Metallic","DPF","Other"].find(t => ptRaw.toLowerCase().includes(t.toLowerCase())) || "Ceramic";
    result.years = lookup(["years", "year", "year range"]) || null;
    const carText = lookup(["car models", "car model", "vehicle", "vehicles", "fitment", "fits", "application"]);
    if (carText) {
      result.model = carText;
      if (!result.years) {
        const ym = carText.match(/\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/);
        if (ym) result.years = ym[0].replace(/\s/g, "");
      }
    }

    const pgmEl = lookupEl(["pgm content", "pgm", "precious metals", "metals"]);
    if (pgmEl) {
      const pgmHtml = pgmEl.innerHTML.toUpperCase();
      const pgmTxt  = cleanText(pgmEl).toUpperCase();
      result.has_platinum  = /\bPT\b/.test(pgmHtml) || /PLATINUM/.test(pgmTxt);
      result.has_palladium = /\bPD\b/.test(pgmHtml) || /PALLADIUM/.test(pgmTxt);
      result.has_rhodium   = /\bRH\b/.test(pgmHtml) || /RHODIUM/.test(pgmTxt);
      const blurred = (pgmHtml.match(/BLURRED/g) || []).length;
      if (blurred >= 1) result.has_platinum  = true;
      if (blurred >= 2) result.has_palladium = true;
      if (blurred >= 3) result.has_rhodium   = true;
    }

    if (!result.has_platinum && !result.has_palladium && !result.has_rhodium) {
      const bodyUp = (document.body.innerText || "").toUpperCase();
      if (/\bPLATINUM\b/.test(bodyUp)) result.has_platinum = true;
      if (/\bPALLADIUM\b/.test(bodyUp)) result.has_palladium = true;
      if (/\bRHODIUM\b/.test(bodyUp))   result.has_rhodium   = true;
    }

    const parsePriceText = (raw) => {
      const clean = raw.replace(/\u00a0/g, "").replace(/\s+/g, " ").trim();
      const zarM = clean.match(/R\s*([\d\s,]+(?:\.\d{1,2})?)/);
      if (zarM) result.price_zar = parseFloat(zarM[1].replace(/[\s,]/g, ""));
      const usdM = clean.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
      if (usdM) result.price_usd = parseFloat(usdM[1].replace(/,/g, ""));
    };

    const priceEl = lookupEl(["price", "cost", "value", "buy price"]);
    if (priceEl) parsePriceText(cleanText(priceEl));
    if (!result.price_zar && !result.price_usd) parsePriceText(document.body.innerText || "");

    if (!result.code || !result.brand) {
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const json = JSON.parse(script.textContent);
          const item = Array.isArray(json) ? json[0] : json;
          if (!result.brand && item.brand) result.brand = typeof item.brand === "object" ? item.brand.name : item.brand;
          if (!result.code && item.sku) result.code = item.sku;
          if (!result.code && item.mpn) result.code = item.mpn;
        } catch (_) {}
      });
    }

    if (!result.code) {
      const parts = window.location.pathname.replace(/\/$/, "").split("/");
      const last = parts[parts.length - 1];
      if (last && last !== "product" && /[a-z0-9]/i.test(last)) result.code = last.toUpperCase();
      if (!result.brand && parts.length >= 2) {
        const b = parts[parts.length - 2];
        if (b && b !== "product" && b !== "en") result.brand = b.charAt(0).toUpperCase() + b.slice(1);
      }
    }

    if (!result.code || !result.brand || (!result.price_zar && !result.price_usd)) {
      const vis = (document.body.innerText || "").replace(/\s+/g, " ");
      if (!result.code) {
        const m = (vis.match(/\b([A-Z]{1,3}[\s\-]?[0-9]{1,4}[A-Z0-9]*)\b/g) || []).find(c => {
          const s = c.replace(/[\s\-]/g, ""); return s.length >= 2 && s.length <= 12;
        });
        if (m) result.code = m.replace(/\s+/g, "").toUpperCase();
      }
      if (!result.brand) {
        for (const b of ["Toyota","Honda","BMW","Mercedes","Volkswagen","VW","Ford","Opel","Nissan","Hyundai","Kia","Mazda","Subaru","Audi","Peugeot","Renault","Fiat","Volvo","Jeep","Mitsubishi","Isuzu","Chrysler","Dodge","Vauxhall","Alfa Romeo","Skoda","Seat","Porsche","Land Rover","Jaguar","Suzuki","Daihatsu"]) {
          if (vis.includes(b)) { result.brand = b; break; }
        }
      }
      if (!result.price_zar) {
        const zm = vis.match(/R\s?([\d\s,]+(?:\.\d{1,2})?)/);
        if (zm) { const v = parseFloat(zm[1].replace(/[\s,]/g, "")); if (!isNaN(v) && v > 10) result.price_zar = v; }
      }
      if (!result.price_usd) {
        const um = vis.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
        if (um) { const v = parseFloat(um[1].replace(/,/g, "")); if (!isNaN(v) && v > 1) result.price_usd = v; }
      }
    }

    const imgSelectors = [
      'img[src*="product_large"]','img[src*="product_medium"]','img[src*="product"]',
      '.product-image img', '[class*="product"] img', '.main-image img',
      '.gallery img', '.carousel img', '.slider img', '[class*="gallery"] img',
      'picture img', 'figure img', '.image-container img', '.thumb img',
      '[class*="thumb"] img', '[class*="photo"] img', '.image-gallery img',
    ];

    const candidates = [];
    const seenUrls = new Set();

    const isLogo = (url) => /\/carbrand\/|\/location\/|logo|icon|banner|flag|brand|manufacturer|favicon|cropped|ecotrade-group|sdn-bhd/i.test(url);
    const normalizeUrl = (url) => url.replace(/[?&#].*$/, '').replace(/-\d+x\d+/gi, '')
      .replace(/\/product_thumb\//i, '/product_large/').replace(/_thumb/i, '')
      .replace(/\/small[^/]*\//i, '/').replace(/\/medium[^/]*\//i, '/');

    for (const sel of imgSelectors) {
      document.querySelectorAll(sel).forEach(img => {
        const src = (img.src || img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original") || "").trim();
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (src && src.startsWith("http") && !isLogo(src) && w > 50 && h > 50) {
          const norm = normalizeUrl(src);
          if (!seenUrls.has(norm)) {
            seenUrls.add(norm);
            candidates.push({ src, w, h, area: w * h });
          }
        }
      });
    }

    if (candidates.length === 0) {
      document.querySelectorAll("img").forEach(img => {
        const src = (img.src || img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original") || "").trim();
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (src && src.startsWith("http") && !isLogo(src) && (w > 200 || h > 200) && w > 60 && h > 60) {
          const norm = normalizeUrl(src);
          if (!seenUrls.has(norm)) {
            seenUrls.add(norm);
            candidates.push({ src, w, h, area: w * h });
          }
        }
      });
    }

    candidates.sort((a, b) => {
      const aLarge = /large|original|full/i.test(a.src);
      const bLarge = /large|original|full/i.test(b.src);
      if (aLarge && !bLarge) return -1;
      if (!aLarge && bLarge) return 1;
      return b.area - a.area;
    });

    result.image_urls = candidates.map(c => c.src);
    result.image_url = result.image_urls[0] || null;

    const maker = lookup(["maker", "manufacturer oem"]);
    const details = lookup(["details", "oem", "oem number"]);
    const noteParts = [maker && maker !== "-" ? `Maker: ${maker}` : null, details ? `OEM: ${details}` : null].filter(Boolean);
    result.notes = noteParts.join(" | ") || null;

    return result;
  });
}

// =====================================================
// HEALTH
// =====================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "playwright-server", uptime: process.uptime(), active_sessions: manualSessions.size });
});

// =====================================================
// START MANUAL LOGIN SESSION
// =====================================================
app.post("/start-manual-login", async (req, res) => {
  try {
    for (const [id, s] of manualSessions.entries()) {
      s.browser.close().catch(() => {});
      manualSessions.delete(id);
    }

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
    });

    const page = await context.newPage();
    await page.goto("https://www.ecotradegroup.com/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    const { email, password } = req.body || {};
    if (email || ECOTRADE_EMAIL) {
      try { await page.fill('input[type="email"], input[name="email"]', email || ECOTRADE_EMAIL); } catch (_) {}
    }
    if (password || ECOTRADE_PASSWORD) {
      try { await page.fill('input[type="password"], input[name="password"]', password || ECOTRADE_PASSWORD); } catch (_) {}
    }

    try {
      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForTimeout(4000);
      try { await page.waitForURL(url => !url.includes("/login"), { timeout: 20000 }); } catch (_) {}
      await page.waitForTimeout(3000);
    } catch (_) {}

    const sessionId = `manual_${Date.now()}`;
    manualSessions.set(sessionId, { browser, context, page, createdAt: Date.now() });

    const cookies = await context.cookies();
    const hasSession = cookies.some(c => c.name === "ECOSESSID");
    const currentUrl = page.url();

    console.log(`[ManualLogin] Session ${sessionId} started. URL: ${currentUrl} hasECOSESSID: ${hasSession}`);

    return res.json({
      success: true,
      sessionId,
      current_url: currentUrl,
      authenticated: hasSession,
      message: hasSession
        ? "Login successful — call /capture-manual-session to save."
        : "Login page ready — submit credentials, then call /capture-manual-session.",
    });

  } catch (err) {
    console.error("[ManualLogin] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// CHECK MANUAL LOGIN STATUS
// =====================================================
app.post("/check-manual-login", async (req, res) => {
  const { sessionId } = req.body || {};
  const session = manualSessions.get(sessionId);
  if (!session) return res.json({ success: false, error: "Session not found or expired" });

  const cookies = await session.context.cookies();
  const hasSession = cookies.some(c => c.name === "ECOSESSID");
  const currentUrl = session.page.url();

  return res.json({ success: true, authenticated: hasSession, current_url: currentUrl });
});

// =====================================================
// CAPTURE MANUAL SESSION
// =====================================================
app.post("/capture-manual-session", async (req, res) => {
  const { sessionId } = req.body || {};
  const session = manualSessions.get(sessionId);
  if (!session) return res.json({ success: false, error: "Session not found or expired. Start a new login." });

  try {
    const { context, browser } = session;

    const testPage = await context.newPage();
    await testPage.goto("https://www.ecotradegroup.com/en/product/toyota/gd-4", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await testPage.waitForLoadState("networkidle", { timeout: 12000 }); } catch (_) {}
    await testPage.waitForTimeout(2000);
    try { await testPage.waitForSelector("tr th", { timeout: 8000 }); } catch (_) {}

    const access = await verifySubscriptionAccess(testPage);
    await testPage.close();

    if (!access.accessValid) {
      return res.json({
        success: false,
        session_invalid: true,
        error: "Session invalid — pricing not visible on test page. Re-login required.",
        access,
      });
    }

    const storageState = await context.storageState();
    const cookieCount = storageState.cookies?.length || 0;

    manualSessions.delete(sessionId);
    browser.close().catch(() => {});

    console.log(`[ManualLogin] Session captured. Cookies: ${cookieCount}`);

    return res.json({
      success: true,
      storageState,
      cookie_count: cookieCount,
      message: `Session captured successfully. ${cookieCount} cookies saved.`,
    });

  } catch (err) {
    console.error("[ManualLogin] Capture error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// SCRAPE PRODUCT
// =====================================================
app.post("/scrape-product", async (req, res) => {
  let browser = null;
  const url = req.body?.url;
  const storageState = req.body?.storageState || null;

  if (!url) return res.status(200).json({ type: "error", error: "Missing url parameter" });
  if (!storageState) return res.status(200).json({ type: "auth_error", error: "No storageState provided. Please re-authenticate." });

  console.log("[Scrape] Single request:", url);

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });

    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 }, storageState });
    console.log("[Scrape] Context created: true");

    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (_) {}
    await page.waitForTimeout(2500);
    try { await page.waitForSelector("tr th", { timeout: 8000 }); } catch (_) {}

    const access = await verifySubscriptionAccess(page);
    console.log(`[Scrape] Access valid: ${access.accessValid}`);

    if (!access.accessValid) {
      await context.close();
      return res.status(200).json({ type: "auth_error", error: "Session invalid or subscription required. Please re-authenticate." });
    }

    const data = await extractProductData(page);
    await context.close();
    console.log(`[Scrape] Result: ${data.type} code=${data.code || "?"}`);
    return res.status(200).json(data);

  } catch (err) {
    console.error("[Scrape] ERROR:", err.message);
    return res.status(200).json({ type: "error", error: err.message });
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
});

// =====================================================
// BATCH SYNC
// =====================================================
app.post("/batch-sync", async (req, res) => {
  let browser = null;
  let context = null;
  const urls = req.body?.urls || [];
  const storageState = req.body?.storageState || null;

  if (!urls.length) return res.status(200).json({ type: "error", error: "No URLs provided" });
  if (!storageState) return res.status(200).json({ type: "auth_error", error: "No storageState provided. Please re-authenticate." });

  console.log(`[BatchSync] Starting batch of ${urls.length} URLs`);

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 }, storageState });
    console.log("[BatchSync] Context created: true");

    const probePage = await context.newPage();
    await probePage.goto(urls[0], { waitUntil: "domcontentloaded", timeout: 90000 });
    try { await probePage.waitForLoadState("networkidle", { timeout: 15000 }); } catch (_) {}
    await probePage.waitForTimeout(2000);

    const probeAccess = await verifySubscriptionAccess(probePage);
    console.log(`[BatchSync] Session probe: valid=${probeAccess.accessValid}`);

    if (!probeAccess.accessValid) {
      await probePage.close();
      return res.status(200).json({ type: "auth_error", session_expired: true, error: "Session invalid on probe. Please re-authenticate." });
    }

    const results = [];
    const probeData = await extractProductData(probePage);
    await probePage.close();
    results.push({ url: urls[0], ...probeData });
    console.log(`[BatchSync] 1/${urls.length} done: ${probeData.code || probeData.type}`);

    for (let i = 1; i < urls.length; i++) {
      const url = urls[i];
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
        try { await page.waitForLoadState("networkidle", { timeout: 12000 }); } catch (_) {}
        await page.waitForTimeout(1500);

        const access = await verifySubscriptionAccess(page);
        if (!access.accessValid) {
          await page.close();
          console.log("[BatchSync] Session expired mid-batch. Stopping.");
          results.push({ url, type: "auth_error", error: "Session expired mid-batch" });
          await context.close();
          return res.status(200).json({ results, session_expired: true });
        }

        const data = await extractProductData(page);
        await page.close();
        results.push({ url, ...data });
        console.log(`[BatchSync] ${i + 1}/${urls.length} done: ${data.code || data.type}`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[BatchSync] Error on ${url}: ${err.message}`);
        results.push({ url, type: "error", error: err.message });
      }
    }

    return res.status(200).json({ results, session_expired: false });

  } catch (err) {
    console.error("[BatchSync] FATAL:", err.message);
    return res.status(200).json({ type: "error", error: err.message });
  } finally {
    if (context) { try { await context.close(); } catch (_) {} }
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
});

// =====================================================
// LOGIN — auto login
// =====================================================
app.post("/login", async (req, res) => {
  let browser = null;
  try {
    if (!ECOTRADE_EMAIL || !ECOTRADE_PASSWORD) {
      return res.status(400).json({ success: false, error: "ECOTRADE_EMAIL and ECOTRADE_PASSWORD not set" });
    }

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    await page.goto("https://www.ecotradegroup.com/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.fill('input[type="email"], input[name="email"]', ECOTRADE_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', ECOTRADE_PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForTimeout(5000);
    try { await page.waitForURL(url => !url.includes("/login"), { timeout: 15000 }); } catch (_) {}
    await page.waitForTimeout(2000);

    const state = await context.storageState();
    const ecosessid = state.cookies?.find(c => c.name === "ECOSESSID");
    if (!ecosessid) throw new Error("Login completed but no ECOSESSID cookie found");

    console.log(`[Login] Success. ${state.cookies.length} cookies captured.`);
    await context.close();

    return res.json({ success: true, storageState: state, cookie_count: state.cookies?.length || 0, message: "Login successful." });
  } catch (err) {
    console.error("[Login] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
});

// =====================================================
// /function — Browserless-compatible
// =====================================================
app.post("/function", express.text({ type: "application/javascript" }), async (req, res) => {
  let browser = null;
  const tmpFile = require("path").join(require("os").tmpdir(), `fn_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  try {
    const code = req.body;
    if (!code) return res.status(400).json({ error: "No code provided" });
    require("fs").writeFileSync(tmpFile, code);

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    const mod = await import("file://" + tmpFile);
    const fn = mod.default;
    const result = await fn({ page });

    await context.close();
    return res.json(result);
  } catch (err) {
    console.error("[Function] Error:", err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    try { require("fs").unlinkSync(tmpFile); } catch (_) {}
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
});

// =====================================================
// /content — Browserless-compatible
// =====================================================
app.post("/content", async (req, res) => {
  let browser = null;
  try {
    const { url, cookies, gotoOptions, waitForTimeout } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });

    if (cookies && cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) return route.abort();
      return route.continue();
    });

    await page.goto(url, {
      waitUntil: gotoOptions?.waitUntil || "domcontentloaded",
      timeout: gotoOptions?.timeout || 30000,
    });

    if (waitForTimeout) await page.waitForTimeout(waitForTimeout);

    const html = await page.content();
    await context.close();
    return res.send(html);
  } catch (err) {
    console.error("[Content] Error:", err.message);
    return res.status(500).send(err.message);
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
});

// =====================================================
// START
// =====================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Playwright server running on port ${PORT}`));
