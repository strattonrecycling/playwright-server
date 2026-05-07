const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// Health check (Render will use this)
app.get('/', (req, res) => {
  res.send('Playwright server is running');
});

// Main scraping endpoint (Browserless replacement)
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
      headless: true
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    const content = await page.content();

    await browser.close();

    res.json({
      success: true,
      content
    });

  } catch (error) {
    if (browser) await browser.close();

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
});
