/* The control: the same page with the browser's own localStorage and no
   PluStore. Same play attempt, same observations. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8409);
const b = await browser({ port: 9399 });

const HOOK = `Object.defineProperty(window,'RufflePlayer',{configurable:true,get:function(){return c;},set:function(v){try{v.config=Object.assign({},v.config,{logLevel:'trace'});}catch(e){}c=v;}});var c=null;`;

const hold = async (x, y, ms) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(ms);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await b.goto(origin + '/_ltf3/control2.html', 3000);
  await sleep(12000);
  console.log('metadata: ' + await b.raw("JSON.stringify((function(){var p=document.querySelector('ruffle-player');return p&&p.metadata?{w:p.metadata.width,h:p.metadata.height,frames:p.metadata.numFrames,fps:p.metadata.frameRate,loaded:p.metadata.loaded}:null;})())"));
  await b.click(632, 400);
  await sleep(6000);
  console.log('play-button state: ' + await b.raw("String(document.querySelector('ruffle-player').shadowRoot.querySelector('#play-button') && getComputedStyle(document.querySelector('ruffle-player').shadowRoot.querySelector('#play-button')).display)"));

  const before = b.events.console.length;
  await sleep(20000);
  const pts = [[632, 400], [632, 520], [500, 300], [760, 300]];
  for (let i = 0; i < 20; i++) {
    const [x, y] = pts[i % pts.length];
    await hold(x, y, 1400);
    await sleep(700);
  }
  const traces = b.events.console.slice(before).filter((c) => /LOG:/.test(c.text)).map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 120));
  console.log('new movie log lines after play+drive: ' + traces.length);
  console.log(traces.slice(0, 12).join('\n'));
  console.log('real localStorage keys: ' + await b.raw('JSON.stringify(Object.keys(localStorage))'));
  console.log('ruffle save manager entries: ' + await b.raw("JSON.stringify(Object.keys(localStorage).filter(function(k){return k.indexOf('/') > 0;}))"));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
