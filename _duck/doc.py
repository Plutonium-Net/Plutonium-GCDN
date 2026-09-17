import re, sys

P = 'STORAGE.md'
doc = open(P, encoding='utf-8').read()
orig = doc

def sub_once(old, new, count=1):
    global doc
    n = doc.count(old)
    assert n == count, f'expected {count} of {old!r}, found {n}'
    doc = doc.replace(old, new)

# ── 1. Renumber what follows, before the new section is inserted ──────────────
# Top-level headings 14..18 shift by one (no ### subsections exist under them).
for old, new in [(18, 19), (17, 18), (16, 17), (15, 16), (14, 15)]:
    doc = re.sub(rf'^## {old}\. ', f'## {new}. ', doc, flags=re.M)

# Anchors.
for old, new in [(18, 19), (17, 18), (16, 17), (15, 16), (14, 15)]:
    doc = doc.replace(f'(#{old}-', f'(#{new}-')

# Prose references.
def shift_section(m):
    n = int(m.group(1))
    return f'section {n + 1}' if 14 <= n <= 18 else m.group(0)

doc = re.sub(r'section (1[4-8])(?=[\s.,)\]]|$)', shift_section, doc)

assert '## 15. Verifying a conversion' in doc
assert '## 19. Known limits' in doc
assert '(#19-known-limits)' in doc
assert '(#16-inspecting-a-save)' in doc
assert not re.search(r'^### 1[5-9]\.', doc, flags=re.M), 'unexpected subsection numbers'

# ── 2. Insert the Flash section before the (renumbered) verifying section ─────
FLASH = r'''## 14. Flash (Ruffle)

`games/duck-life/` is a Mochi-era Flash build: one `duck-life.swf` played by
Ruffle, a WASM Flash player. Nothing inside the movie is patched — this is the
shortest conversion in the document — but two things about Ruffle are not
obvious: the key its saves are named by, and the fact that its save is already
`localStorage`.

### 14.1 The save is a SharedObject, and Ruffle's backend is localStorage

Flash's save is a `SharedObject`: a movie calls
`SharedObject.getLocal("mydata")`, keeps state in `.data`, and writes it with
`.flush()`. Duck Life's whole save is that one object —

    stalvl  runlvl  flylvl  swilvl  seed  skill  money  colour  hat

— and Ruffle keeps it in `localStorage`: its wasm carries
`ruffle_web::storage::LocalStorageBackend` and reaches the browser through
`window.localStorage`. A Flash game is therefore a Web Storage game
([section 11](#11-web-storage-localstorage)) with one wrinkle, and the area swap
in [section 11.1](#111-repair-the-area-not-the-call-sites) is the whole job.

### 14.2 Load PluStore before `ruffle.min.js`

```html
<script src="../../js/plustore.js"></script>
<script>
  PluStore.configure({ game: 'duck-life' });
  var storage = PluStore.installSharedObjects('duck-life.swf');
  if (!storage) { console.error('…the save would go to the browser store'); }
</script>
<script src="ruffle/ruffle.min.js"></script>
```

and the movie is handed over as before:

```js
player.load('duck-life.swf');
```

Order is not optional: Ruffle reads a movie's save as it loads it, so the area has
to be in place before the movie starts. The movie name is the one argument the
call needs — [section 14.3](#143-the-key-ruffle-composes-and-why-the-movie-is-named)
is why — and `installSharedObjects` returns the installed area or `null` if the
browser refused the swap, exactly like `installWebStorage()`.

### 14.3 The key Ruffle composes, and why the movie is named

Ruffle names a slot after the movie's own URL, in Flash's own shape
(`<domain><path>/<movie>.swf/<name>`), so what reaches the area is

    127.0.0.1/games/duck-life/duck-life.swf/mydata

The port is *not* part of that; the host is. The same folder opened as
`http://localhost:5500/` asks for `localhost/games/duck-life/…` instead — a
different key for the same save, which reads as progress that vanished when only
the address changed. `installSharedObjects('duck-life.swf')` narrows every key to

    duck-life.swf/mydata

so the document holds a name that does not move with the page. The mapper only
ever sees keys: a SharedObject's name is separate from the data inside it, so
nothing within the save is rewritten by this.

That the narrowing is real was measured rather than assumed. With it installed, a
value written through a key composed for `127.0.0.1` reads back through the
`localhost` spelling of the same key — one save, two hosts. The area also answers
`key(i)` and `Object.keys()` in Ruffle's own spelling, so nothing that enumerates
sees names it does not recognise.

### 14.4 The surface Ruffle uses is the property one

Wrapping the installed area and logging every way into it showed Ruffle reaching
the area as `localStorage[name]` — a property read and a property write — and
never through `getItem`/`setItem`. It wrote the same bytes nine times during one
boot: Ruffle flushes a SharedObject on a schedule of its own, so `fileWrites` in
`PluStore.stats()` counts a boot, not a save the player made.

This is why [section 11.6](#116-the-second-surface-localstoragekey) exists. An
area that answered only by method would leave Ruffle reading `undefined` and
writing through a property that nothing serialises — silently, on every boot, with
the movie loading and playing perfectly in between.

### 14.5 What has to be vendored, and why both core pairs

The published page loaded `ruffle.min.js` from jsDelivr and carried the save off
through `js/sync.js`. Both are gone. What replaces them is the release that page
already pinned (`@ruffle-rs/ruffle 0.2.0-nightly.2025.10.2`, MIT / Apache-2.0, both
licences kept beside it) copied into `games/duck-life/ruffle/`, plus the movie.

**Both core pairs have to come along.** `ruffle.min.js` probes
`WebAssembly.validate()` for SIMD and four other extensions and loads
`core.ruffle.ae105…` + `f7f28e….wasm` when all five are present, falling back to
`core.ruffle.9085…` + `4d8824….wasm` otherwise ("falling back to the vanilla
WebAssembly module"). A current browser uses one pair and the other looks like
13 MB of dead weight; a browser without SIMD has no player at all without it.

One bug in the wrapper the page shipped with is worth recording, because it looks
like a broken path and is not one: it called `player.load("$1")` — a template
placeholder that was never filled in — so Ruffle was handed a four-character
string where a movie belongs and nothing ever started.

### 14.6 The calls that leave the machine, and the guard that stops them

The movie carries MochiAds' preloader stub, which fetches
`http://x.mochiads.com/srv/1/<id>.swf` and pings
`http://mochibot.com/my/core.swf` every time the game is opened. Both URLs live
*inside the SWF*, so there is nothing to delete in a script file — and both only
ever failed anyway (a dead host sends no CORS headers), so refusing them changes
nothing the movie does. The page refuses them in a `window.fetch` guard: same
origin, `data:` and `blob:` pass; anything else is rejected with a warning, once
per URL. Ruffle never uses `XMLHttpRequest` — its wasm contains no such string,
and one `fetch_with_request` — so `window.fetch` is the whole surface.

### 14.7 Reading the save, and applying one from outside

A SharedObject's bytes are AMF0, base64'd into an `@file` block: an entry is a
`uint16` name length, the name, one AMF0 type byte, then the payload — a number is
`00` and eight big-endian bytes, a string is `02` and a prefixed length. So
`duck-life.swf/mydata` can be read with no tooling at all:

    @file duck-life.swf/mydata
    AL8AAACxVENTTwAEAAAAAAAGbXlkYXRh…

Two rules for writing one back by hand. A hand edit is inert until the page is
reloaded. And a *live* player flushes its own in-memory save when the page goes
away, which overwrites anything written while it was up — measured here: a
doctored save written into the very page that was playing the game was replaced by
the player's dying flush before the next boot could read it, while the same bytes
written from a page that was *not* running the game were handed to Ruffle at the
next boot and survived there.

### 14.8 Verifying a Flash conversion

- every request the page makes is loopback, and the two Mochi URLs appear as
  refusals rather than as outbound requests;
- no exceptions, and no IndexedDB — Ruffle uses none;
- the document holds one block, keyed `duck-life.swf/mydata`;
- the movie renders and responds to input. This is the check that says the player
  works at all: the canvas is not blank, and a click changes the frame;
- the round trip: write a doctored SharedObject from a page that is not playing
  the game, load the game, and confirm both that Ruffle is handed exactly those
  bytes and that the game's own variables keep them.

Eight further Ruffle wrappers are in this repo still on the old bridge
(`duck-life-2`, `duck-life-3`, `learn-to-fly`, `learn-to-fly-2`, `learn-to-fly-3`,
`motox3m-3`, `the-binding-of-isaac`, `the-worlds-hardest-game`). Each needs the
same three things: the player vendored, `installSharedObjects('<movie>.swf')`
before it, and the movie named correctly.

---

'''

sub_once('## 15. Verifying a conversion', FLASH + '## 15. Verifying a conversion')

# ── 3. The adapters table, the catalogue counts, the API table, the limits ────
sub_once(
    '| Fancade (Poki) player |',
    '| Flash (Ruffle SharedObjects) | `PluStore.installSharedObjects(\'<movie>.swf\')` — the same area, with Ruffle\'s host-shaped keys narrowed to "<movie>/<name>" | implemented, in use — see [`games/duck-life/`](games/duck-life/) and [section 14](#14-flash-ruffle) |\n| Fancade (Poki) player |'
)

sub_once(
    '   `<script src="../../js/sync.js"></script>` — fifteen games are on PluStore\n'
    '   so far, and 19 of the 35 in this repo still load that bridge (`tiny-fishing`\n'
    '   loads neither, so it saves nothing at all yet).',
    '   `<script src="../../js/sync.js"></script>` — fifteen games are on PluStore\n'
    '   so far, and 18 of the 34 in this repo still load that bridge (`tiny-fishing`\n'
    '   loads neither, so it saves nothing at all yet).'
)

sub_once(
    '| `configure({game, key, mount, filePrefix, backend})` | set up before the game loads |',
    '| `configure({game, key, mount, filePrefix, backend})` | set up before the game loads |\n'
    '| `installSharedObjects(movie)` | the Web Storage area, with Ruffle\'s host-shaped SharedObject keys narrowed to `"<movie>/<name>"` |'
)

sub_once(
    '## 19. Known limits\n',
    '## 19. Known limits\n\n'
    '- **A Flash save is named by the player, host and all.** Ruffle keys a\n'
    '  SharedObject `<domain><path>/<movie>.swf/<name>`, so the address the page was\n'
    '  opened from would be part of the save\'s name and `localhost` and `127.0.0.1`\n'
    '  would be two saves ([section 14.3](#143-the-key-ruffle-composes-and-why-the-movie-is-named)).\n'
    '  `installSharedObjects(movie)` narrows it, and the movie argument is not\n'
    '  optional bookkeeping: leave it out and the save follows the hostname again.\n'
    '- **A Flash save is written on the player\'s schedule.** Ruffle flushes a\n'
    '  SharedObject on its own tick and once more as the page goes away, so\n'
    '  `fileWrites` counts a boot rather than a save, and a hand edit made while the\n'
    '  game is running can be overwritten by that dying flush before anything reads\n'
    '  it.\n'
    '- **A Flash conversion needs both Ruffle core pairs, and a movie that is named.**\n'
    '  The player picks its wasm by probing for WebAssembly extensions, so the pair a\n'
    '  current browser does not use still has to ship, and `player.load()` has to be\n'
    '  given a real movie rather than the placeholder a wrapper may carry.\n'
)

assert doc != orig
open(P, 'w', encoding='utf-8', newline='\n').write(doc)
print('STORAGE.md now', len(doc.splitlines()), 'lines')
