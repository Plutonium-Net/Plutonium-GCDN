import json, os, re

HOST = open('_sr/host.txt').read().strip() + '/'
PREFIX = HOST + ''            # everything lives under .../files/
OUT = 'games/soccer-random'

STORE_SITE1 = 'k=new e(k);return new g(k)'
STORE_SITE1_NEW = ('if(self.PluStore&&self.PluStore.stores)return self.PluStore.stores.instance(k);'
                   'k=new e(k);return new g(k)')
STORE_SITE2 = 'self.localforage=new g(new e("localforage"))'
STORE_SITE2_NEW = ('self.localforage=self.PluStore&&self.PluStore.stores?'
                   'self.PluStore.stores.instance("localforage"):new g(new e("localforage"))')
SDK_OLD = '"https://cdn.jsdelivr.net/gh/st39/sdk@main/sdk.js"'
SDK_NEW = '"./gmsdk.js"'

files = ['data.json', 'scripts/main.js', 'scripts/c3runtime.js', 'scripts/dispatchworker.js',
         'scripts/jobworker.js', 'scripts/register-sw.js', 'scripts/offlineclient.js',
         'scripts/supportcheck.js', 'style.css']
for rel in files:
    p = os.path.join(OUT, rel)
    raw = open(p, encoding='utf-8').read()
    before = raw
    raw = raw.replace(PREFIX, '')
    if rel.endswith('c3runtime.js'):
        for old, new in ((STORE_SITE1, STORE_SITE1_NEW), (STORE_SITE2, STORE_SITE2_NEW),
                         (SDK_OLD, SDK_NEW)):
            n = raw.count(old)
            raw = raw.replace(old, new)
            print('  patch %-22s x%d' % (old[:22], n))
    if raw != before:
        open(p, 'w', encoding='utf-8', newline='').write(raw)
        print('%-32s rewrote' % rel)

print('\nremaining absolute URLs per file:')
for rel in files + ['index.html']:
    p = os.path.join(OUT, rel)
    if not os.path.exists(p):
        continue
    raw = open(p, encoding='utf-8').read()
    urls = sorted(set(re.findall(r'https?://[A-Za-z0-9./_%:?=&#@+~-]*', raw)))
    if urls:
        print(rel)
        for u in urls:
            print('   ', u)
