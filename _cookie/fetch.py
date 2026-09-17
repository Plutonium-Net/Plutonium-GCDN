import json, os, subprocess, sys, urllib.request, hashlib, base64, concurrent.futures

TREE = '_cookie/ugs.json'
OUT = 'games/cookie-clicker'
PREFIX = 'cookieclicker/'

d = json.load(open(TREE, encoding='utf-8'))
files = [f for f in d['tree'] if f['path'].startswith(PREFIX) and f['type'] == 'blob']

# Pin to the commit the listing came from.
req = urllib.request.Request('https://api.github.com/repos/bubbls/UGS-Assets/commits/main',
                             headers={'User-Agent': 'pluto-gcdn'})
commit = json.load(urllib.request.urlopen(req))['sha']
print('commit', commit)


def git_sha1(data):
    h = hashlib.sha1()
    h.update(b'blob %d\0' % len(data))
    h.update(data)
    return h.hexdigest()


def one(f):
    rel = f['path'][len(PREFIX):]
    dest = os.path.join(OUT, rel.replace('/', os.sep))
    url = 'https://raw.githubusercontent.com/bubbls/UGS-Assets/%s/%s' % (commit, f['path'])
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'pluto-gcdn'})
            data = urllib.request.urlopen(req, timeout=60).read()
            break
        except Exception as e:
            if attempt == 3:
                return ('FAIL', rel, str(e), 0)
    got = git_sha1(data)
    if got != f['sha']:
        return ('HASH', rel, '%s != %s' % (got, f['sha']), len(data))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as fh:
        fh.write(data)
    return ('OK', rel, '', len(data))


ok = bad = 0
total = 0
problems = []
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
    for status, rel, note, size in ex.map(one, files):
        if status == 'OK':
            ok += 1
            total += size
        else:
            bad += 1
            problems.append((status, rel, note))

print('ok %d  bad %d  bytes %d (%.2f MB)' % (ok, bad, total, total / 1048576))
for p in problems:
    print('  ', p)
