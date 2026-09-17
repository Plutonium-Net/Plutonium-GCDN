import { launch, sleep } from './cdp.mjs';
const url = process.argv[2];
const { page, close } = await launch();
await page.navigate(url);
await page.waitFor('!!window.PluStore', 20000, 'PluStore');
await sleep(18000);
const out = await page.evaluate(`JSON.stringify({
  page: location.href,
  doc: PluStore.get(),
  keys: (() => { const o = []; for (let i = 0; i < localStorage.length; i++) o.push(localStorage.key(i)); return o; })()
})`);
console.log(url, '->');
console.log(out);
await close();
