/* Look at what the movie is showing, so clicks can be aimed at real buttons. */
import { serve, browser, sleep } from './h.mjs';
import { decodePng, ascii, nonBlack } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8405);
const b = await browser({ port: 9395 });
const shot = async () => decodePng(Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "Object.defineProperty(window,'RufflePlayer',{configurable:true,get:function(){return c;},set:function(v){try{v.config=Object.assign({},v.config,{logLevel:'trace'});}catch(e){}c=v;}});var c=null;"
  });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(12000);
  console.log('box: ' + await b.raw("JSON.stringify((function(){var e=document.getElementById('flash-container')||document.querySelector('ruffle-player');var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})())"));
  await b.click(632, 400);
  await sleep(6000);
  const png = await shot();
  console.log('full nonBlack ' + nonBlack(png).toFixed(3));
  console.log(ascii(png, 110, 34));
  console.log('--- movie log');
  console.log(b.events.console.filter((c) => /LOG:/.test(c.text)).slice(-14).map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 160)).join('\n'));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
