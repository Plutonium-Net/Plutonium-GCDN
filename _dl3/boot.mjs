/* Duck Life 3 boot: does the movie start, what does it write, what does it fetch? */
import { launch, pngStats, sleep } from './cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8342';
const page = await launch();
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');
page.on('Page.frameNavigated', (p, sid) => { if (sid === page.sessionId) console.log('NAV ->', p.frame.url); });

page.raw.onClose(() => console.log('!! browser died'));
await page.navigate(BASE + '/games/duck-life-3/index.html');

for (let i = 0; i < 12; i++) {
  await sleep(3000);
  const p = `_dl3/f${String(i).padStart(2,'0')}.png`;
  await page.screenshot(p);
  const s = pngStats(p);
  let doc = 'n/a', stats = 'n/a';
  try { doc = await page.evaluate('PluStore.get().length'); } catch (e) { doc = 'eval failed'; }
  try { stats = await page.evaluate('JSON.stringify(PluStore.stats())'); } catch (e) {}
  console.log('t=' + ((i + 1) * 3) + 's', 'hash=' + s.hash, 'draw=' + s.nonblank, 'docLen=' + doc, stats === 'n/a' ? '' : stats);
}

console.log('--- console');
for (const c of page.listeners.console.slice(-25)) console.log('  ', c.type + ':', c.text.slice(0, 220));
console.log('--- exceptions', JSON.stringify(page.listeners.errors));
const remote = page.listeners.network.filter((n) => !n.url.startsWith(BASE) && !n.url.startsWith('data:') && !n.url.startsWith('blob:'));
console.log('--- remote requests:', remote.length);
for (const n of remote) console.log('   ', n.url.slice(0, 140));
console.log('--- loopback requests:', page.listeners.network.length - remote.length);
page.close();
process.exit(0);
