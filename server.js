const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Playwright server is running');
});

// MAIN SCRAPE ENDPOINT (original)
app.post('/scrape', async (req, res) => {
  return handleScrape(req, res);
});

// COMPATIBILITY ENDPOINT (fix for Base44 mismatch)
app.post('/scrape-product', async (req, res) => {
  return handleScrape(req, res);
});

async function handleScrape(req, res) {
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

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const content = await page.content();
    const text = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return res.json({
      success: true,
      data: {
        url,
        content,
        text
      }
    });

  } catch (error) {
    if (browser) await browser.close();

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
