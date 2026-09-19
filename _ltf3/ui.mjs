import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8395);
const b = await browser({ port: 9385 });
const say = (s) => console.log(s);
const ui = `(function(){
  var p=document.querySelector('ruffle-player'); if(!p||!p.shadowRoot) return 'none';
  var out={};
  ['splash-screen','play-button','unmute-overlay','panic','message-overlay','container'].forEach(function(id){
    var e=p.shadowRoot.querySelector('#'+id);
    if(!e){out[id]='absent';return;}
    var r=e.getBoundingClientRect();
    out[id]=getComputedStyle(e).display+' rect='+[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',')+' text='+JSON.stringify(e.textContent.replace(/\s+/g,' ').slice(0,60));
  });
  return JSON.stringify(out);
})()`;
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  for (const t of [8000, 16000, 24000]) {
    await sleep(t === 8000 ? 8000 : 8000);
    say('at ' + (t/1000) + 's: ' + await b.raw(ui));
  }
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
