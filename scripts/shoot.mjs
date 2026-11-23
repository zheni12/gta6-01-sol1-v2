// Screenshot runner: serves game/ locally, opens each ?shot= scene from
// shots.json in headless Chromium, and saves JPEGs into screenshots/.
// Fails loudly on any page error or an image over the 256 KiB cap.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/hatch/lemo-opuscar/node_modules/playwright-core');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const gameDir = join(repoRoot, 'game');
const shots = JSON.parse(readFileSync(join(repoRoot, 'shots.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = normalize(join(gameDir, rel));
  if (!file.startsWith(gameDir)) { res.writeHead(403); res.end(); return; }
  try {
    const data = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((resolve) => server.listen(8137, '127.0.0.1', resolve));

function findChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    const p = join(base, d, 'chrome-linux64', 'chrome');
    try { statSync(p); return p; } catch { /* keep looking */ }
  }
  throw new Error('no chromium build found under ' + base);
}

let failures = 0;
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const url = `http://127.0.0.1:8137/index.html${shot.query}`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const out = join(repoRoot, 'screenshots', shot.name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 72 });
    const size = statSync(out).size;
    const ok = errors.length === 0 && size <= 262144;
    if (!ok) failures++;
    console.log(`${shot.name}: ${size} bytes${size > 262144 ? ' (OVER 256 KiB!)' : ''}${errors.length ? ' ERRORS: ' + errors.join(' | ') : ' ok'}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.error(`${failures} shot(s) failed`); process.exit(1); }
console.log('all shots done');
