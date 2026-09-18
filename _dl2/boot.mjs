/* Boot Duck Life 2 headless: does the movie load, does it draw, what does it
   write, and does anything leave the machine? */
import { launch, sleep } from './cdp.mjs';

const URL_BASE = process.env.BASE || 'http://127.0.0.1:8341';
const page = await launch();
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');

await page.navigate(URL_BASE + '/games/duck-life-2/index.html');
await sleep(4000);

const dpr = await page.evaluate('devicePixelRatio');
const shot = { w: 1280, h: 800 };

async function frameSignature() {
  return page.evaluate(`(() => {
    const c = document.querySelector('ruffle-player')?.shadowRoot?.querySelector('canvas')
           || document.querySelector('canvas');
    if (!c) return null;
    const g = document.createElement('canvas');
    g.width = 64; g.height = 40;
    const x = g.getContext('2d');
    x.drawImage(c, 0, 0, 64, 40);
    const d = x.getImageData(0, 0, 64, 40).data;
    let hash = 0, nonblank = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i+1] + d[i+2];
      if (v > 30) nonblank++;
      hash = (hash * 31 + v) | 0;
    }
    return { w: c.width, h: c.height, nonblank: nonblank / (d.length / 4), hash };
  })()`);
}

const first = await frameSignature();
console.log('first frame:', JSON.stringify(first));
await page.screenshot('_dl2/1-boot.png');

/* Let the intro run, then look at the storage layer. */
await sleep(6000);
const second = await frameSignature();
console.log('after 6s:', JSON.stringify(second));
await page.screenshot('_dl2/2-intro.png');

const state = await page.evaluate(`JSON.stringify({
  plustore: typeof PluStore,
  docLen: PluStore.get().length,
  stats: PluStore.stats(),
  keys: Object.keys(localStorage),
  idb: null
})`);
console.log('state:', state);

console.log('--- console');
for (const c of page.listeners.console) console.log(' ', c.type, c.text.slice(0, 200));
console.log('--- exceptions');
for (const e of page.listeners.errors) console.log(' ', e);
console.log('--- network (non-loopback first)');
const nonLocal = page.listeners.network.filter((n) => !n.url.startsWith(URL_BASE) && !n.url.startsWith('data:') && !n.url.startsWith('blob:'));
for (const n of nonLocal) console.log('  REMOTE', n.method, n.url);
console.log('  loopback requests:', page.listeners.network.length - nonLocal.length);
for (const n of page.listeners.network.filter((n) => n.url.startsWith(URL_BASE))) console.log('   ', n.url.replace(URL_BASE, ''));

page.close();
