import { serve, browser, sleep } from './h.mjs';
import { decodePng, ascii, nonBlack } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8396);
const b = await browser({ port: 9386 });
const say = (s) => console.log(s);
const playVisible = `(function(){var p=document.querySelector('ruffle-player');if(!p||!p.shadowRoot)return '?';var e=p.shadowRoot.querySelector('#play-button');return e?getComputedStyle(e).display:'absent';})()`;
async function shot(){const r=await b.send('Page.captureScreenshot',{format:'png'});return decodePng(Buffer.from(r.data,'base64'));}
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(12000);
  say('before click: play-button=' + await b.raw(playVisible));
  await b.click(632, 400);
  await sleep(3000);
  say('after click: play-button=' + await b.raw(playVisible) + '  non-black=' + (nonBlack(await shot())*100).toFixed(1) + '%');
  for (let i = 1; i <= 8; i++) {
    await sleep(15000);
    const p = await shot();
    say((3 + 15 * i) + 's: fileWrites=' + await b.raw('PluStore.stats().fileWrites') + '  non-black=' + (nonBlack(p) * 100).toFixed(1) + '%  playBtn=' + await b.raw(playVisible));
  }
  say('=== screen');
  say(ascii(await shot(), 96, 30));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
