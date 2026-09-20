import json, os, re, sys, urllib.request, urllib.error

HOST = open('_sr/host.txt').read().strip() + '/'
OUT = 'games/soccer-random'
raw = open('_sr/data.json', encoding='utf-8').read()
d = json.loads(raw)
P = d['project']

# images referenced by absolute URL in data.json
imgs = sorted(set(re.sub(r'.*/files/', '', u) for u in re.findall(r'https?://[^"\\]+?\.png', raw)))
cot = json.loads(P[3][0][0] if False else 'null') if False else None

sounds = [s[0] for s in P[7]]
media = ['media/%s.webm' % n for n in sounds]

scripts = [
    'box2d.wasm.js', 'box2d.wasm', 'data.json', 'style.css', 'loading-logo.png', 'sw.js',
    'scripts/supportcheck.js', 'scripts/offlineclient.js', 'scripts/main.js',
    'scripts/register-sw.js', 'scripts/c3runtime.js', 'scripts/dispatchworker.js',
    'scripts/jobworker.js', 'scripts/workermain.js',
]
cands = imgs + media + scripts

os.makedirs(OUT, exist_ok=True)
log = []
for rel in cands:
    url = HOST + rel
    dest = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read()
            open(dest, 'wb').write(body)
            log.append((rel, r.status, len(body)))
    except urllib.error.HTTPError as e:
        log.append((rel, e.code, 0))

w = sum(1 for _, s, n in log if s == 200)
print('downloaded %d / %d' % (w, len(log)))
for rel, s, n in log:
    if s != 200:
        print('  MISS %s -> %s' % (rel, s))
