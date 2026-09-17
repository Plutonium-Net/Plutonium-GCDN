import re, io, sys

SRC = '_cookie/upstream-index.html'
DST = 'games/cookie-clicker/index.html'

src = io.open(SRC, encoding='utf-8-sig', newline='').read()
out = src
edits = []


def sub(pattern, repl, text, flags=0, note=''):
    new, n = re.subn(pattern, repl, text, flags=flags)
    edits.append((note, n))
    return new


# ── A. Pin LOCAL: this build is local, whatever host serves it ────────────────
out = sub(
    r"\tvar LOCAL=\(App \|\| !window\.location\.hostname \|\| window\.location\.hostname==='localhost' \|\| window\.location\.hostname==='127\.0\.0\.1'\);",
    "\t/* This build is local: every asset sits beside this file and nothing is\r\n"
    "\t   fetched from anywhere else. LOCAL is the game's own switch — ajax(),\r\n"
    "\t   getJson(), the ad slots, the update check and the resource path all\r\n"
    "\t   test it — so pinning it true is what makes the game offline on any\r\n"
    "\t   host, not just on localhost where the original happened to default. */\r\n"
    "\tvar LOCAL=true;",
    out, note='pin LOCAL')

# ── B. Drop the external block: cookie consent, Cloudflare fonts, FB pixel ────
start = out.index('<!-- external -->')
end = out.index('<!-- /external -->') + len('<!-- /external -->')
out = out[:start] + ('<!-- The cookie-consent loader, the Facebook pixel and the\r\n'
                     '     original host\'s @font-face URLs were here. All three are\r\n'
                     '     remote, and all three were already skipped when LOCAL was\r\n'
                     '     true, so the build has no use for them. The page falls\r\n'
                     '     back to its own fonts. -->') + out[end:]
edits.append(('drop external block', 1))

# ── C. Ad loaders in the head: keep the LOCAL stub, drop the two remote tags ──
out = sub(
    r'<script src="showads\.js"></script><!-- this just detects adblockers so we can adjust the layout and play nice -->\r?\n'
    r'<script async src="https://pagead2\.googlesyndication\.com/pagead/js/adsbygoogle\.js"></script>\r?\n'
    r'<script>\r?\n'
    r'\s*\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\r?\n'
    r'\s*google_ad_client: "ca-pub-5622691057838054",\r?\n'
    r'\s*enable_page_level_ads: true\r?\n'
    r'\s*\}\);\r?\n'
    r'</script>\r?\n',
    '\t<!-- The Google ad loader and the adblock-detector stub were here. The\r\n'
    '\t     stub above is kept on purpose: the game\'s layout code calls\r\n'
    '\t     adsbygoogle, and with LOCAL true the stub is what answers it. The\r\n'
    '\t     game adds its own `noAds` class and lays the page out without the\r\n'
    '\t     ad column. -->\r\n',
    out, note='drop head ad loaders')

# ── D. PluStore, and the storage swap, before the game loads ─────────────────
out = sub(
    r'<link href="style\.css\?v=10c" rel="stylesheet" type="text/css">\r?\n'
    r'<script src="main2\.js\?v=13g"></script>\r?\n',
    '<link href="style.css?v=10c" rel="stylesheet" type="text/css">\r\n'
    '\r\n'
    '<script src="../../js/plustore.js"></script>\r\n'
    '<script>\r\n'
    '\tPluStore.configure({ game: \'cookie-clicker\' });\r\n'
    '\r\n'
    '\t/* The game saves through localStorage — CookieClickerGame, a second slot\r\n'
    '\t   for the beta, and CookieClickerLang — and it also calls localStorage\r\n'
    '\t   directly in a few places, so the area itself is replaced rather than\r\n'
    '\t   the helpers. After this line every one of those reads and writes is an\r\n'
    '\t   @file block in the PluStore document, and the browser\'s own store is\r\n'
    '\t   unreachable from this page. Must run before main2.js, which reads the\r\n'
    '\t   save while it loads. */\r\n'
    '\tvar pluStorage = PluStore.installWebStorage();\r\n'
    '\tif (!pluStorage) console.error(\'PluStore could not take over localStorage; this save would be lost\');\r\n'
    '</script>\r\n'
    '\r\n'
    '<script src="main2.js?v=13g"></script>\r\n',
    out, note='load PluStore + install storage')

# ── E. Body: the ad slots and the dead backfill scripts ─────────────────────
head, sep, body = out.partition('<body>')
body = sub(
    r'\t*<!-- Cookie Clicker Header Responsive -->.*?</ins>\r?\n',
    '', body, flags=re.S, note='drop header ad slot <ins>')
body = sub(
    r'\t*<!-- Cookie Clicker Responsive -->.*?</ins>\r?\n',
    '', body, flags=re.S, note='drop responsive ad slot <ins>')
body = sub(
    r'\t*<script>\r?\n\t*\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);\r?\n\t*</script>\r?\n',
    '', body, note='drop adsbygoogle pushes')
before = len(body)
body = sub(
    r'\t*<script>\r?\n\t*if \(!LOCAL\)\r?\n(?:.*?\r?\n)*?\t*</script>\r?\n',
    '', body, note='drop dead backfill scripts')
out = head + sep + body

# ── F. Tail: the original host's Cloudflare challenge script ────────────────
out = sub(
    r'<script>\(function\(\)\{function c\(\).*?</script>',
    '<!-- The host\'s Cloudflare challenge script was here; it loads from\r\n'
    '     /cdn-cgi/, which only exists on that host. -->',
    out, flags=re.S, note='drop cloudflare script')

io.open(DST, 'w', encoding='utf-8', newline='').write(out)

print('%-34s %s' % ('edit', 'replacements'))
for note, n in edits:
    print('%-34s %d' % (note, n))
print()
print('bytes in/out: %d -> %d' % (len(src), len(out)))
for probe in ['https://', '//pagead2', 'connect.facebook', 'googleapis', 'cf-fonts',
              '/cdn-cgi/', 'showads.js', 'serve.app.playsaurus', 'cdnjs.cloudflare',
              'base href', 'sync.js']:
    print('  %-22s %d' % (probe, out.count(probe)))
