import { launch } from './h.mjs';

const b = await launch({ headful: process.argv.includes('--headful') });
try {
  await b.goto('/games/soccer-random/index.html');
  await new Promise(r => setTimeout(r, 12000));

  const reqs = [...new Set(b.requests())];
  const off = reqs.filter(u => !u.startsWith('http://127.0.0.1:5500'));
  console.log('requests: %d, off-machine: %d', reqs.length, off.length);
  off.forEach(u => console.log('  OFF', u));
  const fails = b.events.filter(e => e.method === 'Network.loadingFailed')
    .map(e => e.params.errorText + ' ' + (e.params.blockedReason || ''));
  console.log('failed loads:', fails.length);
  [...new Set(fails)].forEach(f => console.log('  ', f));

  console.log('exceptions:', b.exceptions().length);
  b.exceptions().forEach(e => console.log('  ', e));
  console.log('--- console');
  b.console().forEach(l => console.log('  ', l));

  const info = await b.evaluate(`(() => {
    const c = document.querySelector('canvas');
    const cs = getComputedStyle(c);
    return {
      canvases: document.querySelectorAll('canvas').length,
      w: c.width, h: c.height,
      shown: cs.display, rect: c.getBoundingClientRect().width + 'x' + c.getBoundingClientRect().height,
      blank: (() => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
        return false; })(),
      top: (document.elementFromPoint(innerWidth/2, innerHeight/2) || {}).id || '(none)',
      plu: typeof PluStore, cfg: PluStore.config().game,
    };
  })()`);
  console.log('page:', JSON.stringify(info));

  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('_sr/shot.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot -> _sr/shot.png');
} finally {
  await b.close();
}
