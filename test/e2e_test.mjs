import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extPath = join(__dirname, '..', 'dist');
const contentScriptSrc = readFileSync(join(extPath, 'content-script.js'), 'utf-8');
const TARGET_URL = 'https://www.21shares.com/en-row/research/bitcoins-outlook-in-the-aftermath-of-epic-fury';

(async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    channel: 'chrome',
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
  });

  const page = await context.newPage();
  console.log('Navigating...');
  await page.goto(TARGET_URL);
  await page.waitForTimeout(4000);

  const result = await page.evaluate(async (scriptSrc) => {
    window.chrome = {
      runtime: {
        onMessage: { addListener(fn) { window.__contentHandler = fn; } }
      }
    };
    const s = document.createElement('script');
    s.textContent = scriptSrc;
    document.head.appendChild(s);
    await new Promise(r => setTimeout(r, 500));
    if (!window.__contentHandler) return { error: 'handler not registered' };
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ error: 'timeout' }), 20000);
      window.__contentHandler({ type: 'EXTRACT' }, null, (resp) => {
        clearTimeout(t);
        resolve(resp);
      });
    });
  }, contentScriptSrc);

  if (result?.type === 'EXTRACTION_COMPLETE') {
    const r = result.result;
    const date = r.emailDate || r.pageDate
      || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    console.log('\n--- Export header ---');
    console.log(`# ${r.emailSubject || r.title}`);
    console.log(r.sourceUrl);
    console.log(date);
    console.log('\n--- pageDate raw ---', r.pageDate);
    console.log('\n--- Body (first 400 chars) ---');
    console.log(r.markdown?.substring(0, 400));
  } else {
    console.log('Result:', JSON.stringify(result, null, 2));
  }

  await context.close();
})();
