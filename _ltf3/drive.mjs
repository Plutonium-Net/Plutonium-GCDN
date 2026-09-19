import { serve, browser, sleep } from './h.mjs';
import { decodePng, nonBlack } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8398);
const b = await browser({ port: 9388 });
const say = (s) => console.log(s);
const written = async () => (await b.raw('PluStore.stats().fileWrites')) > 0;
async function key(k, code, vk) {
  for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: type === 'keyDown' && k.length === 1 ? k : undefined });
}
async function shotSig() {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  const p = decodePng(Buffer.from(r.data, 'base64'));
  return nonBlack(p);
}
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(12000);
  await b.click(632, 400);          // dismiss Ruffle's play button
  await sleep(3000);
  say('started; driving');
  const spots = [[632, 400], [632, 300], [480, 350], [760, 450], [632, 600], [400, 450], [900, 400]];
  for (let i = 0; i < 400; i++) {
    const [x, y] = spots[i % spots.length];
    await b.click(x, y);
    if (i % 4 === 0) await key(' ', 'Space', 32);
    if (i % 11 === 0) await key('Enter', 'Enter', 13);
    await shotSig();
    if (await written()) { say('WROTE at iteration ' + i + ' (' + x + ',' + y + ')'); break; }
    await sleep(120);
  }
  say('final fileWrites=' + await b.raw('PluStore.stats().fileWrites'));
  say('doc: ' + await b.raw("(function(){try{var d=localStorage.getItem('plu:text:learn-to-fly-3');return d?d.length+' chars, blocks '+d.split('\n').filter(function(l){return l.indexOf('@file ')==0;}).length:'none'}catch(e){return 'x'}})()"));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
