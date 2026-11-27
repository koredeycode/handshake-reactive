import { chromium } from '/home/yusufakoredey/merview/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4199';
const OUT = '/home/yusufakoredey/hackathons/handshake/docs/screenshots';
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: '01-home-desktop', route: '/', width: 1440, height: 900 },
  { name: '02-new-order-desktop', route: '/new', width: 1440, height: 1000 },
  { name: '03-orders-desktop', route: '/orders', width: 1440, height: 1000 },
  { name: '04-faucet-desktop', route: '/faucet', width: 1440, height: 1000 },
  { name: '05-home-mobile', route: '/', width: 390, height: 844 },
  { name: '06-new-order-mobile', route: '/new', width: 390, height: 844 },
  { name: '07-orders-mobile', route: '/orders', width: 390, height: 844 },
  { name: '08-faucet-mobile', route: '/faucet', width: 390, height: 844 },
  { name: '09-verify-desktop', route: '/verify/0x456fb0f0e70d19b8e2717bd952b41424dc80abdb0cc0699e83a803090ce88a69', width: 1440, height: 1000 },
];

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
  try {
    await page.goto(BASE + shot.route, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });
    const dims = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    console.log(shot.name, 'OK', JSON.stringify(dims));
  } catch (e) {
    console.log(shot.name, 'FAIL', e.message.slice(0, 200));
  }
  await page.close();
}
await browser.close();
