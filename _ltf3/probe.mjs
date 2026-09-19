import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8394);
const b = await browser({ port: 9384 });
const say = (s) => console.log(s);
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(20000);
  say('shadow text: ' + JSON.stringify(await b.raw("(function(){var p=document.querySelector('ruffle-player');return p&&p.shadowRoot?p.shadowRoot.textContent.slice(0,400):'none';})()")));
  say('shadow html head: ' + JSON.stringify(await b.raw("(function(){var p=document.querySelector('ruffle-player');return p&&p.shadowRoot?p.shadowRoot.innerHTML.replace(/\s+/g,' ').slice(0,600):'none';})()")));
  say('player attrs: ' + await b.raw("(function(){var p=document.querySelector('ruffle-player');if(!p)return 'none';var o={};for(var a of p.attributes)o[a.name]=a.value;return JSON.stringify(o);})()"));
  say('--- all console ---');
  for (const c of b.events.console) say('  [' + c.type + '] ' + String(c.text).slice(0, 260));
  say('--- exceptions --- ' + JSON.stringify(b.events.exceptions.slice(0, 5)));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
