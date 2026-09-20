import { launch } from './h.mjs';
import { writeFileSync } from 'node:fs';

const b = await launch({ headful: process.argv.includes('--headful') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await b.goto('/games/soccer-random/index.html');
  await sleep(10000);

  // what the runtime is holding, and what it asked for
  console.log(await b.evaluate(`(async () => {
    const names = PluStore.stores.names();
    const inst = localforage.createInstance({ name: 'c3-localstorage-025bjaucvn0' });
    await inst.setItem('probe', { marker: 'soccer-random', n: 1234 });
    await localforage.setItem('default-probe', 'via the default instance');
    const dbs = await indexedDB.databases();
    return JSON.stringify({ storeNamesBeforeWrite: names, stats: PluStore.stats(),
      idb: dbs.map(d => d.name), doc: PluStore.get().length,
      html: !!document.querySelector('canvas') }, null, 1);
  })()`, true));

  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('_sr/shot.png', Buffer.from(shot.data, 'base64'));

  // reload: the document must still hold both probes
  await b.goto('/games/soccer-random/index.html');
  await sleep(8000);
  console.log(await b.evaluate(`(async () => {
    const inst = localforage.createInstance({ name: 'c3-localstorage-025bjaucvn0' });
    return JSON.stringify({ storeNames: PluStore.stores.names(),
      probe: await inst.getItem('probe'),
      def: await localforage.getItem('default-probe'),
      entries: PluStore.stores.entries('c3-localstorage-025bjaucvn0') }, null, 1);
  })()`, true));

  const off = [...new Set(b.requests())].filter(u => !u.startsWith('http://127.0.0.1:5500'));
  const bad = [...new Set(b.events.filter(e => e.method === 'Network.responseReceived' &&
    e.params.response.status >= 400).map(e => e.params.response.status + ' ' + e.params.response.url))];
  console.log('off-machine after reload:', off.length, off);
  console.log('>=400:', bad.join('\n  '));
  console.log('exceptions:', b.exceptions());
} finally {
  await b.close();
}
