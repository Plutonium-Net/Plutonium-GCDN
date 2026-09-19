/* Prove the SharedObject key mapper: the localPath shape, the movie shape, and
   host independence for both — run once on 127.0.0.1 and once on localhost, the
   two addresses that used to be two different saves. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8401);

const PROBE = (host) => `(function () {
  PluStore.configure({ game: 'mapper-probe', key: 'plu:text:mapper-probe' });
  PluStore.clear();
  var r = { host: ${JSON.stringify(host)} };

  var ltf3 = PluStore.installSharedObjects('learn-to-fly-3.swf');
  PluStore.files.write('/#LearnToFly3/profileData', 'SEED-A');
  r.localPathRead = ltf3.getItem(${JSON.stringify(host)} + '//#LearnToFly3/profileData');
  r.localPathEnumerated = ltf3.key(0);

  var duck = PluStore.installSharedObjects('duck-life.swf');
  PluStore.files.write('duck-life.swf/mydata', 'SEED-B');
  r.movieRead = duck.getItem(${JSON.stringify(host)} + '/games/duck-life/duck-life.swf/mydata');
  r.movieEnumerated = duck.key(1);

  /* Ruffle's actual verbs are property reads and writes, not the methods: it
     enumerates with ownKeys and then does localStorage[key] = text. */
  ltf3[${JSON.stringify(host)} + '//#LearnToFly3/profileData'] = 'SEED-D';
  r.propertyWriteLanded = PluStore.files.read('/#LearnToFly3/profileData');
  r.propertyReadBack = ltf3[${JSON.stringify(host)} + '//#LearnToFly3/profileData'];
  r.propertyDeleteGone = (delete ltf3[${JSON.stringify(host)} + '//#LearnToFly3/profileData'],
                          PluStore.files.has('/#LearnToFly3/profileData'));

  /* a bare name from something that is not Ruffle must survive intact */
  duck.setItem('plain-name', 'SEED-C');
  r.plainIsPlain = PluStore.files.names().indexOf('plain-name') >= 0;

  r.documentKeys = PluStore.files.names();
  PluStore.clear();
  return r;
})()`;

const b = await browser({ port: 9391 });
try {
  const first = await b.raw(`(function(){ location.hostname })()`);
  for (const addr of ['127.0.0.1', 'localhost']) {
    await b.goto(`http://${addr}:8401/_ltf3/blank.html`, 900);
    const out = await b.raw(PROBE(addr));
    console.log(JSON.stringify(out));
    await sleep(200);
  }
  console.log('page 1 host was ' + first);
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
