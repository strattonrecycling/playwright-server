const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json({ limit: '15mb' }));

// ===============================
// HEALTH CHECK
// ===============================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'playwright-server',
    uptime: process.uptime()
  });
});

// ===============================
// UNIFIED HANDLER
// ===============================
async function runBrowserTask({ url, mode = 'content' }) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    let result = {};

    if (mode === 'screenshot') {
      const image = await page.screenshot({ fullPage: true });
      result.screenshot = image.toString('base64');
    }

    if (mode === 'content' || mode === 'scrape') {
      result.content = await page.content();
      result.text = await page.evaluate(() => document.body.innerText);
    }

    if (mode === 'title') {
      result.title = await page.title();
    }

    await browser.close();

    return {
      success: true,
      url,
      mode,
      data: result
    };

  } catch (error) {
    if (browser) await browser.close();

    return {
      success: false,
      error: error.message
    };
  }
}

// ===============================
// URL NORMALISER (IMPORTANT)
// ===============================
function extractUrl(body) {
  return (
    body.url ||
    body.productUrl ||
    body.target ||
    body.link ||
    body.href ||
    body.website
  );
}

// ===============================
// MAIN COMPATIBILITY ROUTES
// (Browserless + Base44 SAFE)
// ===============================

// Generic scrape
app.post(['/scrape', '/scrape-product', '/content'], async (req, res) => {
  const url = extractUrl(req.body);

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required',
      received: req.body
    });
  }

  const result = await runBrowserTask({
    url,
    mode: 'scrape'
  });

  res.json(result);
});

// Screenshot endpoint
app.post(['/screenshot', '/capture'], async (req, res) => {
  const url = extractUrl(req.body);

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  const result = await runBrowserTask({
    url,
    mode: 'screenshot'
  });

  res.json(result);
});

// Title endpoint (lightweight)
app.post('/title', async (req, res) => {
  const url = extractUrl(req.body);

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  const result = await runBrowserTask({
    url,
    mode: 'title'
  });

  res.json(result);
});

// ===============================
// ERROR SAFETY FALLBACK
// ===============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    availableRoutes: [
      '/scrape',
      '/scrape-product',
      '/content',
      '/screenshot',
      '/capture',
      '/title'
    ]
  });
});

// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Playwright stable server running on port ${PORT}`);
});
