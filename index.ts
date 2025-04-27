import express from 'express';
import type { Request, Response } from 'express'; // Use type-only import
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio'; // Changed to namespace import
import path from 'path';
import fs from 'fs/promises'; // Use promises for async file operations

const app = express();
const port = 3000;

// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));

// Middleware to serve static files (like screenshots)
// Need to figure out __dirname in ES Modules context
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/public', express.static(path.join(__dirname, 'public')));


// Route to display the form
app.get('/', (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gofile Video Fetcher</title>
      <style>
        body { font-family: sans-serif; margin: 2em; background-color: #f4f4f4; }
        form { background: #fff; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        label { display: block; margin-bottom: 8px; }
        input[type="url"] { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 3px; }
        button { background-color: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .result { margin-top: 20px; padding: 15px; background: #e9ecef; border-radius: 5px; }
        img { max-width: 100%; height: auto; margin-top: 10px; border: 1px solid #ddd; }
        video { max-width: 100%; margin-top: 10px; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <h1>Enter Gofile Download URL</h1>
      <form action="/fetch" method="POST">
        <label for="gofileUrl">Gofile URL:</label>
        <input type="url" id="gofileUrl" name="gofileUrl" required>
        <button type=\"submit\">Fetch Video</button>
      </form>
    </body>
    </html>
  `);
});

// Route to handle form submission and fetch video
// Explicitly type the handler return as Promise<void> to fix overload error
app.post('/fetch', async (req: Request, res: Response): Promise<void> => {
  const gofileUrl = req.body.gofileUrl;

  if (!gofileUrl || typeof gofileUrl !== 'string') {
     res.status(400).send('Invalid URL provided.');
     return; // Ensure function exits
  }

  let browser;
  try {
    console.log(`Fetching URL: ${gofileUrl}`);
    browser = await puppeteer.launch({
      headless: true, // Changed from 'new' to boolean true
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(gofileUrl, { waitUntil: 'networkidle2', timeout: 60000 }); // Increased timeout

    // Wait for potential video element
    const mediaSelector = 'video source[src], video[src]'; // Look for video source or video with src
    let videoSrc: string | null = null;
    let screenshotPathRelative: string | null = null;

    try {
        await page.waitForSelector(mediaSelector, { timeout: 30000 }); // Wait longer if needed
        console.log('Video element selector found.');

        videoSrc = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            // Check if it's a source element inside a video or the video itself
            return element ? element.getAttribute('src') : null;
        }, mediaSelector);

        if (videoSrc) {
             console.log(`Found video source via Puppeteer: ${videoSrc}`);
        } else {
            console.log('Video source not found directly via Puppeteer, trying Cheerio fallback.');
        }

    } catch (e) {
        console.warn('Video element selector not found within timeout via Puppeteer.');
    }


    // Take screenshot regardless of finding the video element initially
    const screenshotFilename = `screenshot_${Date.now()}.png`;
    const screenshotPathAbsolute = path.join(__dirname, 'public', screenshotFilename);
    await fs.mkdir(path.join(__dirname, 'public'), { recursive: true }); // Ensure public dir exists
    await page.screenshot({ path: screenshotPathAbsolute, fullPage: true });
    screenshotPathRelative = `/public/${screenshotFilename}`; // Path for HTML src attribute
    console.log(`Screenshot saved to ${screenshotPathAbsolute}`);


    // If Puppeteer didn't find the src, try parsing the full HTML with Cheerio as a fallback
    if (!videoSrc) {
        console.log('Attempting Cheerio fallback...');
        const html = await page.content();
        const $ = cheerio.load(html);
        const videoElement = $('video source[src]').first() || $('video[src]').first(); // Check source first, then video tag
        videoSrc = videoElement.attr('src') || null;
        if (videoSrc) {
            console.log(`Found video source via Cheerio: ${videoSrc}`);
        } else {
            console.log('Video source not found via Cheerio either.');
        }
    }

    await browser.close();
    browser = null; // Ensure browser is marked as closed

    // Send response back to client
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
        <title>Gofile Video Result</title>
         <style>
            body { font-family: sans-serif; margin: 2em; background-color: #f4f4f4; }
            .result { margin-top: 20px; padding: 15px; background: #fff; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1, h2 { color: #333; }
            a { color: #007bff; }
            img { max-width: 100%; height: auto; margin-top: 10px; border: 1px solid #ddd; display: block; }
            video { max-width: 100%; margin-top: 10px; border: 1px solid #ddd; display: block; }
            p { word-wrap: break-word; }
        </style>
      </head>
      <body>
        <div class=\"result\">
          <h1>Result for: ${gofileUrl}</h1>
          ${videoSrc ? `
            <h2>Video Found</h2>
            <p>Video URL: <a href=\"${videoSrc}\" target=\"_blank\">${videoSrc}</a></p>
            <video controls>
              <source src=\"${videoSrc}\" type=\"video/webm\"> <!-- Assuming webm, adjust if needed -->
              Your browser does not support the video tag.
            </video>
          ` : `
            <h2>Video Not Found</h2>
            <p>Could not automatically extract a video source URL from the page.</p>
          `}

          ${screenshotPathRelative ? `
            <h2>Page Screenshot</h2>
            <img src=\"${screenshotPathRelative}\" alt=\"Screenshot of ${gofileUrl}\">
          ` : `
            <p>Screenshot could not be generated.</p>
          `}
        </div>
        <a href=\"/\">Try another URL</a>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Error processing request:', error);
    if (browser) {
        await browser.close(); // Ensure browser is closed on error
    }
    // Ensure response is sent even on error
    if (!res.headersSent) {
        res.status(500).send(`Error fetching or processing the URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});