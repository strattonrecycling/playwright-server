const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json({ limit: '10mb' }));

// Health check (Render uses this sometimes)
app.get('/', (req, res) => {
  res.send('Playwright server is running');
});

// Main Browserless replacement endpoint
// Base44 should call this instead of Browserless API
app.post('/scrape', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

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

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Full HTML content (Browserless-style response)
    const content = await page.content();

    // Optional: useful extracted text version
    const text = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return res.json({
      success: true,
      data: {
        content,
        text,
        url
      }
    });

  } catch (error) {
    if (browser) await browser.close();

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Optional: screenshot endpoint (very useful for Base44 AI tools)
app.post('/screenshot', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    const screenshot = await page.screenshot({
      fullPage: true
    });

    await browser.close();

    return res.json({
      success: true,
      screenshot: screenshot.toString('base64')
    });

  } catch (error) {
    if (browser) await browser.close();

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
