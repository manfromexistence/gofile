import { Elysia, t, type Static } from 'elysia';
import { html } from '@elysiajs/html';
import axios from 'axios';

// Helper function for delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const app = new Elysia()
  .use(html())
  .get('/', () => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fetch Website HTML</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body { font-family: sans-serif; padding: 2rem; background-color: #f0f0f0; }
            #result { white-space: pre-wrap; word-wrap: break-word; background-color: #fff; padding: 1rem; border: 1px solid #ccc; margin-top: 1rem; max-height: 60vh; overflow-y: auto; font-family: monospace;}
            button { cursor: pointer; padding: 0.5rem 1rem; margin-left: 0.5rem; }
            #loading { display: none; margin-top: 1rem; }
            #copy-button { display: none; }
        </style>
    </head>
    <body>
        <h1 class="text-2xl font-bold mb-4">Fetch Website HTML</h1>
        <form id="fetch-form" class="flex items-center">
            <input type="url" id="url" name="url" placeholder="Enter website URL (e.g., https://example.com)" required class="border p-2 flex-grow mr-2">
            <button type="submit" class="bg-blue-500 text-white p-2 rounded hover:bg-blue-600">Fetch HTML</button>
        </form>

        <div id="loading" class="text-gray-600">Fetching after delay... please wait.</div>
        <div id="error" class="text-red-500 mt-2"></div>

        <div class="mt-4">
            <button id="copy-button" class="bg-green-500 text-white p-2 rounded hover:bg-green-600">Copy to Clipboard</button>
        </div>
        <pre id="result"></pre>

        <script>
            const form = document.getElementById('fetch-form');
            const urlInput = document.getElementById('url');
            const resultDiv = document.getElementById('result');
            const errorDiv = document.getElementById('error');
            const loadingDiv = document.getElementById('loading');
            const copyButton = document.getElementById('copy-button');

            form.addEventListener('submit', async function(event) {
                event.preventDefault();
                var url = urlInput.value;
                resultDiv.textContent = '';
                errorDiv.textContent = '';
                loadingDiv.style.display = 'block';
                copyButton.style.display = 'none';

                try {
                    var response = await fetch('/fetch', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ url: url }),
                    });

                    loadingDiv.style.display = 'none';

                    if (!response.ok) {
                        var errorData = await response.json();
                        throw new Error((errorData && errorData.error) ? errorData.error : 'HTTP error! status: ' + response.status);
                    }

                    var data = await response.json();
                    resultDiv.textContent = data.html;
                    copyButton.style.display = 'inline-block';
                } catch (e) {
                    console.error('Fetch error:', e);
                    errorDiv.textContent = 'Error: ' + (e && e.message ? e.message : e);
                    loadingDiv.style.display = 'none';
                    copyButton.style.display = 'none';
                }
            });

            copyButton.addEventListener('click', function() {
                navigator.clipboard.writeText(resultDiv.textContent)
                    .then(function() {
                        alert('HTML copied to clipboard!');
                    })
                    .catch(function(err) {
                        console.error('Failed to copy text: ', err);
                        alert('Failed to copy HTML.');
                    });
            });
        </script>
    </body>
    </html>
  `)
  .post('/fetch', async ({ body }: { body: { url: string } }) => {
      const { url } = body;
      console.log(`Received request to fetch: ${url}`);

      // Add a delay (e.g., 5 seconds)
      const delaySeconds = 30;
      console.log(`Waiting for ${delaySeconds} seconds...`);
      await sleep(delaySeconds * 1000);
      console.log('Delay finished. Fetching HTML...');

      try {
          const response = await axios.get(url, {
              headers: {
                  // Add headers to mimic a browser if needed
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              },
              timeout: 15000 // Add a timeout for the axios request itself (15 seconds)
          });
          console.log(`Successfully fetched HTML from ${url}`);
          return { html: response.data };
      } catch (error: any) {
          console.error(`Error fetching ${url}:`, error.message);
          // Check for specific axios errors or return a generic message
          let errorMessage = 'Failed to fetch HTML.';
          if (axios.isAxiosError(error)) {
              errorMessage = error.response?.data || error.message || errorMessage;
              if (error.code === 'ECONNABORTED') {
                  errorMessage = 'Request timed out.';
              }
          } else if (error instanceof Error) {
              errorMessage = error.message;
          }
          // Return an error status code and message
          return new Response(JSON.stringify({ error: errorMessage }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
          });
      }
  }, {
      body: t.Object({
          url: t.String({ format: 'uri' }) // Validate input as a URI
      })
  })
  .listen(3000);

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
);