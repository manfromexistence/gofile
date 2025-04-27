import { Elysia, t } from 'elysia';
import { html } from '@elysiajs/html';
import staticPlugin from '@elysiajs/static';
import * as puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch'; // Add node-fetch for backend video fetching

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Elysia()
  .use(html())
  .use(staticPlugin({
    assets: path.join(__dirname, 'public'),
    prefix: '/public'
  }));

const port = 3000;

// Route to display the form
app.get('/', ({ html }) => html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gofile Video Fetcher (Elysia)</title>
      <style>
        body { font-family: sans-serif; margin: 2em; background-color: #f4f4f4; }
        form { background: #fff; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        label { display: block; margin-bottom: 8px; }
        input[type="url"] { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 3px; }
        button { background-color: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .result { margin-top: 20px; padding: 15px; background: #e9ecef; border-radius: 5px; }
        img, video, iframe { max-width: 100%; height: auto; margin-top: 10px; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <h1>Enter Gofile Download URL</h1>
      <form action="/fetch" method="POST">
        <label for="gofileUrl">Gofile URL:</label>
        <input type="url" id="gofileUrl" name="gofileUrl" required>
        <button type="submit">Fetch Video</button>
      </form>
    </body>
    </html>
  `));

// New route to proxy video content
app.get('/video/:contentId', async ({ params, set }) => {
  let browser: puppeteer.Browser | null = null;
  try {
    const contentId = params.contentId;
    const gofileUrl = `https://gofile.io/d/${contentId}`;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(gofileUrl, { waitUntil: 'networkidle2', timeout: 50000 });

    const mediaSelector = 'video source[src], video[src]';
    await page.waitForSelector(mediaSelector, { timeout: 30000 });

    const videoSrc = await page.evaluate((selector: string) => {
      const element = document.querySelector(selector);
      return element ? element.getAttribute('src') : null;
    }, mediaSelector);

    if (!videoSrc) {
      throw new Error('Video source not found');
    }

    // Get cookies for the video request
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Fetch video content with cookies
    const response = await fetch(videoSrc, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'video/webm',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.statusText}`);
    }

    // Log response headers for debugging
    console.log('Video response headers:', Object.fromEntries(response.headers));

    const videoBuffer = await response.arrayBuffer();

    await browser.close();
    browser = null;

    // Set headers to ensure video streams
    set.headers['Content-Type'] = 'video/webm';
    set.headers['Content-Disposition'] = 'inline';
    set.headers['Accept-Ranges'] = 'bytes';

    return new Response(videoBuffer, {
      status: 200,
    });
  } catch (error) {
    console.error('Error in video proxy:', error);
    if (browser) {
      await browser.close();
    }
    set.status = 500;
    return `Error fetching video: ${error instanceof Error ? error.message : String(error)}`;
  }
});

// Updated route to handle form submission and fetch video
app.post('/fetch', async ({ body, set, html: htmlResponse }) => {
  const gofileUrl = body.gofileUrl;

  if (!gofileUrl || typeof gofileUrl !== 'string') {
    set.status = 400;
    return 'Invalid URL provided.';
  }

  let browser: puppeteer.Browser | null = null;
  try {
    console.log(`Fetching URL: ${gofileUrl}`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(gofileUrl, { waitUntil: 'networkidle2', timeout: 50000 });

    const mediaSelector = 'video source[src], video[src]';
    let videoSrc: string | null = null;
    let screenshotPathRelative: string | null = null;
    let contentId: string | null = null;

    // Extract content ID from URL
    const urlMatch = gofileUrl.match(/gofile\.io\/d\/([a-zA-Z0-9-]+)/);
    if (urlMatch) {
      contentId = urlMatch[1] ?? null;
    }

    try {
      await page.waitForSelector(mediaSelector, { timeout: 30000 });
      console.log('Video element selector found.');

      await page.evaluate((selector: string) => {
        const media = document.querySelector(selector);
        return new Promise<void>((resolve) => {
          if (!media) return resolve();
          if (media.getAttribute('src')) return resolve();
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                if (media.getAttribute('src')) {
                  observer.disconnect();
                  resolve();
                  return;
                }
              }
            }
          });
          observer.observe(media, { attributes: true });
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 5000);
        });
      }, mediaSelector);

      videoSrc = await page.evaluate((selector: string) => {
        const element = document.querySelector(selector);
        return element ? element.getAttribute('src') : null;
      }, mediaSelector);

      if (videoSrc) {
        console.log(`Found video source via Puppeteer: ${videoSrc}`);
      }
    } catch (e) {
      console.warn('Video element selector not found within timeout.');
    }

    // Wait an additional 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take screenshot
    const screenshotFilename = `screenshot_${Date.now()}.png`;
    const screenshotPathAbsolute = path.join(__dirname, 'public', screenshotFilename);
    await fs.mkdir(path.join(__dirname, 'public'), { recursive: true });
    await page.screenshot({ path: screenshotPathAbsolute, fullPage: true });
    screenshotPathRelative = `/public/${screenshotFilename}`;
    console.log(`Screenshot saved to ${screenshotPathAbsolute}`);

    // Fallback to Cheerio if Puppeteer fails
    let fetchedHtml = await page.content();
    if (!videoSrc) {
      console.log('Attempting Cheerio fallback...');
      const $ = cheerio.load(fetchedHtml);
      const videoElement = $('video source[src]').first() || $('video[src]').first();
      videoSrc = videoElement.attr('src') || null;
      if (videoSrc) {
        console.log(`Found video source via Cheerio: ${videoSrc}`);
      } else {
        console.log('Video source not found via Cheerio.');
      }
    }

    await browser.close();
    browser = null;

    // Save original HTML
    const outputFilePath = path.join(__dirname, 'output.html');
    try {
      await fs.writeFile(outputFilePath, fetchedHtml);
      console.log(`Original fetched HTML saved to ${outputFilePath}`);
    } catch (writeError) {
      console.error(`Error writing HTML: ${writeError}`);
    }

    // Construct results HTML
    const resultsHtml = `
      <div style="border: 2px solid blue; padding: 15px; margin: 10px; background-color: #eee; color: #333; font-family: sans-serif;">
        <h2>Extraction Results</h2>
        <p>Original URL: <a href="${gofileUrl}" target="_blank">${gofileUrl}</a></p>
        ${videoSrc && contentId ? `
          <h3>Video Found</h3>
          <p>Video URL: <a href="${videoSrc}" target="_blank">${videoSrc}</a></p>
          <h4>Stream via Proxy</h4>
          <video controls style="max-width: 100%; margin-top: 10px; border: 1px solid #ccc;">
            <source src="/video/${contentId}" type="video/webm">
            Your browser does not support the video tag.
          </video>
          <h4>View in Gofile Player (Iframe)</h4>
          <iframe src="${gofileUrl}" width="800" height="600" style="border: 1px solid #ccc;"></iframe>
        ` : `
          <h3>Video Not Found</h3>
          <p>Could not extract video source or content ID.</p>
        `}
        ${screenshotPathRelative ? `
          <h3>Page Screenshot</h3>
          <img src="${screenshotPathRelative}" alt="Screenshot of ${gofileUrl}" style="max-width: 100%; height: auto; margin-top: 10px; border: 1px solid #ccc; display: block;">
        ` : `
          <p>Screenshot could not be generated.</p>
        `}
        <hr style="margin: 15px 0;">
        <p><a href="/">Try another URL</a></p>
      </div>
    `;

    // Inject results into HTML
    const headEndIndex = fetchedHtml.toLowerCase().indexOf('</head>');
    let modifiedHtmlResponse = fetchedHtml;
    if (headEndIndex !== -1) {
      modifiedHtmlResponse = fetchedHtml.slice(0, headEndIndex + 7) + resultsHtml + fetchedHtml.slice(headEndIndex + 7);
    } else {
      modifiedHtmlResponse = resultsHtml + fetchedHtml;
    }

    return htmlResponse(modifiedHtmlResponse);
  } catch (error) {
    console.error('Error processing request:', error);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
    set.status = 500;
    return `Error fetching or processing the URL: ${error instanceof Error ? error.message : String(error)}`;
  }
}, {
  body: t.Object({
    gofileUrl: t.String({ format: 'uri', error: 'Invalid URL format provided.' })
  })
});

app.listen(port, () => {
  console.log(`🦊 Elysia server listening at http://localhost:${port}`);
});