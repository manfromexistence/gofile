import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

async function fetchRenderedHtml(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for media element to appear
  const mediaSelector = 'video, audio';
  try {
    await page.waitForSelector(mediaSelector, { timeout: 20000 });
    // Wait for the media to be loaded (readyState >= 2 means at least metadata is loaded)
    await page.evaluate((selector) => {
      const media = document.querySelector(selector);
      return new Promise((resolve) => {
        if (!media) return resolve();
        if (media.readyState >= 2) return resolve();
        media.addEventListener('loadeddata', resolve, { once: true });
      });
    }, mediaSelector);
  } catch (e) {
    console.warn('Media element not found or not loaded in time.');
  }

  // Take a screenshot
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const screenshotPath = path.join(__dirname, 'media_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  const html = await page.content();
  await browser.close();
  return html;
}

// Get URL from command line arguments
const url = process.argv[2];

if (!url) {
  console.error('Please provide a URL as a command-line argument.');
  process.exit(1);
}

// Call the function and print the HTML
fetchRenderedHtml(url)
  .then(html => {
    console.log(html); // Output the fetched HTML to stdout
  })
  .catch(error => {
    console.error('Error fetching HTML:', error);
    process.exit(1);
  });