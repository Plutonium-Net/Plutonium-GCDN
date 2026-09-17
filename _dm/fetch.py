"""Pull Drive Mad from its original Poki host.

The wrapper pointed at cdn.jsdelivr.net/gh/genizy/dmad-poki@49b5ab6..., which now
answers 403, and the GitHub repo behind it answers Not Found — so the only copy
left is the one the wrapper was made from: the poki-gdn URL recorded in the
wrapper's own `window.assgdd` shim. It serves with a browser UA and a poki.com
referer, which is what a page behind the wrapper would have sent.
"""
import hashlib
import os
import sys
import urllib.request

BASE = ('https://f9564e4e-ef25-4e4b-ba67-cb11a1576bbd.poki-gdn.com/'
        'cc1bc57a-e355-4696-97c2-097bf6188606')
ROOT = 'games/drive-mad'

FILES = [
    'index.html',
    'webapp/fancade.css',
    'webapp/favicon.ico',
    'webapp/cover.jpg',
    'webapp/source_min.js',
    'webapp/index.js',
    'webapp/index.wasm',
    'webapp/index.data',
    'datafile_index.data',
    'poki-sdk.js',
]


def get(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'),
        'Referer': 'https://poki.com/',
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    total = 0
    for name in FILES:
        try:
            data = get('%s/%s' % (BASE, name))
        except Exception as exc:                       # noqa: BLE001
            print('%-28s MISSING  (%s)' % (name, exc))
            continue
        path = os.path.join(ROOT, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as fh:
            fh.write(data)
        total += len(data)
        print('%-28s %9d bytes  sha256 %s' % (
            name, len(data), hashlib.sha256(data).hexdigest()[:16]))
    print('\ntotal %d bytes' % total)


if __name__ == '__main__':
    sys.exit(main())
