# PluStore — text save storage

PluStore is how a game in this catalogue saves its progress. Instead of each
engine writing to whatever browser storage it likes, the save is a **single
plain-text document** that the page owns, reads, and writes.

The reference implementation and working example is `snow-rider-3d`. Read
`games/snow-rider-3d/index.html` alongside this document.

- Engine: [`js/plustore.js`](js/plustore.js)
- Reading a save: [section 16](#16-inspecting-a-save)

---

## 1. Why

| | Engine-owned storage | PluStore |
|---|---|---|
| Format | opaque binary / engine internals | readable text |
| Where | one IndexedDB database per engine, shared by every game on the origin | one backend you choose, one document per game |
| Debugging | needs a devtools deep dive | read the document, in a console or a browser's own devtools |
| Backup | not practical | copy a string |
| Editing | not practical | edit the text, reload, done |

Unity WebGL is the clearest case, and the reason this exists. A Unity build
mounts Emscripten's IDBFS over `/idbfs` and drops `PlayerPrefs` in there as a
binary blob (`UnityPrf\0` magic, length-prefixed entries). That data is real
but hostile: per-build MD5 directory names, no readable keys, and every Unity
game on the origin sharing one `/idbfs` store. PluStore decodes it to:

```
#plu-text-store 1
#game snow-rider-3d
#saved 2026-09-16T03:10:38.494Z
@dir /idbfs/38f7b574447025292645b04c764b759c
@unity-prefs /idbfs/38f7b574447025292645b04c764b759c/PlayerPrefs
header	00010000001000
AvailableTime	int	150
ControlMode	int	1
unity.cloud_player_id	str	a0c474d75ad0d88ae8fc0f854cc07440
@end
```

---

## 2. The contract

PluStore is not a general-purpose filesystem. It makes four promises, and a
game wired to it must keep them:

1. **The save is one text document.** Everything a game persists fits in it.
2. **The document only changes through `set()`.** No engine writes around it.
3. **A save can only be applied at boot.** A running game has already acted on
   the values it read, so applying an imported save means reloading the page.
4. **Writes are whole-document.** There is no per-key write path to the
   backing store; `setValue()` rewrites the document.

---

## 3. Quick start: connect a game

Four steps, whatever the engine.

### 3.1 Load the engine, before the game starts

The script must be present and configured *before* the game initialises, since
the game reads its save during startup.

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'my-game', key: 'plu:text:my-game' });</script>
```

`game` is the label that lands in the document header, and it also names the
backend slot: omit `key` and the slot becomes `plu:text:<game>`. Pass `key` only
to point a game at a slot that already exists — two games that share a key share
one save and overwrite each other. `configure()` is re-callable, and calling it
again with a different `key` moves the backend with it, which matters because
that inline call always runs *after* the engine has already configured itself
once at load time.

### 3.2 Remove the old storage method

Do this **before** wiring the new one, or the two will write over each other.
See [section 5](#5-removing-the-old-storage-method) — it is a checklist, not a
suggestion.

### 3.3 Capture the save

Ask the engine for its save bytes and hand the whole thing to `set()`:

```js
PluStore.set(document);
```

Building that document is the only engine-specific part. For Unity and for
Godot the engine does it for you (`flush`, see [section 6](#6-unity-webgl) and
[section 10](#10-godot-4-html5)), and for GameMaker `PluStore.files` does (see
[section 7](#7-gamemaker-html5)); for a key/value engine `PluStore.stores` does
(see [section 8](#8-construct-3-html5)); for an engine whose whole save is
`localStorage`, `PluStore.installWebStorage()` does (see
[section 11](#11-web-storage-localstorage)); for a game that saves through a host
platform's SDK, a local stand-in for that SDK does (see
[section 12](#12-youtube-playables-ytgame)); for anything else you serialise the
engine's own storage into the format in [section 4](#4-document-format).

### 3.4 Restore the save

Rebuild the engine's native storage from the document, then let the game start.
`PluStore.get()` returns the raw document; `PluStore.parse(doc)` turns it into a
tree of directories, `@unity-prefs` blocks, `@text` blocks, `@base64` blocks for
binary files and `@file` blocks.

```js
var tree = PluStore.parse(PluStore.get());
// walk tree.dirs / tree.files and write them back into the engine
```

Then reload the page so the game boots against the restored data.

### Adapters

Restoring is where engines differ, so it is worth being blunt about what
exists today:

| Engine | Adapter | Status |
|---|---|---|
| Unity WebGL | `PluStore.boot(FS, mount)` + `PluStore.flush(FS, mount)` | implemented, in use |
| Godot 4 HTML5 | the same two hooks, plus `is_persistent` answered from PluStore | implemented, in use |
| GameMaker HTML5 (flat named files) | `PluStore.files.read/exists/has/write/ensure/remove` | implemented, in use |
| Construct 3 HTML5 (localforage key/value stores) | `PluStore.stores.instance(name)`, `stores.names()`, `stores.entries(name)` | implemented, in use |
| Construct 2 HTML5 (one localforage global, callback API) | `PluStore.stores.localforage(name)` | implemented, in use |
| Web Storage engines (`localStorage`) | `PluStore.installWebStorage()` — swaps the area, nothing else changes | implemented, in use |
| Web Storage engines that save by property (`localStorage[k] = v`) | the same area; the proxy behind `installWebStorage()` answers by property too | implemented, in use |
| YouTube Playables (`ytgame.game.loadData` / `saveData`) | a local stand-in for the SDK, over the Web Storage area — see [`games/crossy-road/ytgame-local.js`](games/crossy-road/ytgame-local.js) | implemented, in use |
| Flash (Ruffle SharedObjects) | `PluStore.installSharedObjects('<movie>.swf')` — the same area, with Ruffle's host-shaped keys narrowed to "<movie>/<name>" | implemented, in use — see [`games/duck-life/`](games/duck-life/), [`games/duck-life-2/`](games/duck-life-2/) and [section 14](#14-flash-ruffle) |
| Fancade (Poki) player | the same two hooks over the player's `/sandbox` mount, *and* `installWebStorage()` for the `localStorage` half of the same save — see `games/drive-mad/` and [section 13](#13-fancade-poki) | implemented, in use |

A new adapter needs exactly two functions: one that reads the engine's save and
returns a document, one that takes a document and rebuilds the engine's save.
Put them next to the engine hooks in `js/plustore.js`.

The one exception is the Playables stand-in, which lives in the game's folder
rather than in the library: it is not an adapter over an engine's storage but a
replacement for a *platform*, and it defines exactly the members the build in
front of it calls. Copy [`games/crossy-road/ytgame-local.js`](games/crossy-road/ytgame-local.js)
for another Playables game and add whatever it reaches for
([section 12.2](#122-the-local-stand-in)).

---

## 4. Document format

Line-oriented, tab-separated, versioned on the first line.

```
#plu-text-store 1          ← format version, required, must be line 1
#game snow-rider-3d        ← informational
#saved 2026-09-16T03:10Z   ← informational, rewritten on every save
@dir <path>                ← a directory to recreate
@unity-prefs <path>        ← a PlayerPrefs block
header	<hex>              ←   7 header bytes, preserved verbatim
<name>	int	<number>       ←   one line per entry
<name>	float	<number>     ←   a float is written as its exact decimal
<name>	str	<text>
@end
@text <path>               ← a file that is valid UTF-8, stored verbatim
<any number of lines>
@end
@base64 <path>             ← a file that is not UTF-8, stored losslessly
<base64, wrapped or not>
@end
@file <name>               ← one named file, for a host that keeps files flat
<the file's text, escaped onto a single line>
@end
@store <name>              ← one key/value store, for an engine whose save is a
<key>\t<tag>\t<value>      ←   set of stores; one escaped line per entry, sorted
@end
```

Five rules matter:

- **Blocks end at a line reading exactly `@end`.** This is safe for `@text`
  blocks because a raw newline cannot occur inside JSON (it is escaped), and
  every file Unity keeps next to `PlayerPrefs` is JSON. `@file` blocks carry no
  such assumption: their body is escaped onto one line, so a save containing
  CRLF or even a line reading `@end` still cannot break a block open.
- **Tab is the field separator**, so `\`, tab, CR and LF are escaped inside
  fields (`\\`, `\t`, `\r`, `\n`). A reader must unescape; the engine does.
- **Binary files go to `@base64`, never to `@text`.** A UTF-8 decode turns
  every invalid byte into U+FFFD, so storing binary as text loses data the
  moment it is written back. The engine only emits `@text` when a decode is
  provably lossless, and falls back to base64 otherwise.
- **Unknown lines are ignored**, so a game may add its own directives.

`@base64` and `@text` blocks are how any engine stores anything that is not
Unity PlayerPrefs. A Construct save slot, a GameMaker save file, a JSON blob —
all of them become blocks keyed by whatever path or name you like. `@file` is
the same idea for an engine whose save is a *flat set of named files* rather
than a filesystem, and it is what [section 7](#7-gamemaker-html5) uses.
`@store` is the same again for an engine whose save is neither a filesystem nor
a set of files but a set of *key/value stores*: one block per store, one line
per entry, and the type tag keeps `3` and `"3"` apart. That is what
[section 8](#8-construct-3-html5) uses.

---

## 5. Removing the old storage method

The old method and PluStore cannot coexist: whichever writes last wins, and the
result is a save that looks fine and silently loses data. Remove all of it.

1. **Delete the old bridge script tag.** Every converted game dropped
   `<script src="../../js/sync.js"></script>` — seventeen games are on PluStore
   so far, and 16 of the 34 in this repo still load that bridge as a script tag
   (`tiny-fishing` loads neither, so it saves nothing at all yet). Count script
   tags, not mentions: a converted page may still say `js/sync.js` in a comment
   explaining what it replaced.
2. **Delete the engine's own persistence path.** For Unity that is the IDBFS
   mount — [section 6.3](#63-cut-the-indexeddb-persistence). Whatever the old
   path was, the game must stop writing there.
3. **Leave the old data alone.** Do not migrate it and do not delete it. The
   browser still holds it, it is inert, and if the new path turns out wrong the
   old save is still on disk to fall back on.
4. **Check `details.json`.** A truthy `cloudSync` for that game depended on the
   old bridge. `snow-rider-3d` is `false`, so nothing was lost — but a game set
   to `true` loses that capability unless the host is adapted to the text
   document.
5. **Verify nothing else still writes.** Open the game, play, and confirm the
   old store stops changing. For Unity that is the `indexedDB /idbfs` record
   count in [section 15](#15-verifying-a-conversion).

---

## 6. Unity WebGL

Two changes to the page, two changes to the build. That is the whole job.

### 6.1 Load PluStore before the player

In the game's `index.html`, ahead of the loader:

```html
<head>
  <script src="../../js/plustore.js"></script>
  <script>PluStore.configure({ game: 'snow-rider-3d', key: 'plu:text:snow-rider-3d' });</script>
</head>
```

Ordering is not optional. The player reads `PlayerPrefs` while it boots, so
`PluStore` must exist before `UnityLoader.instantiate` runs.

### 6.2 Find the patch points in the build

A Unity build ships two scripts; only the second needs touching:

```
Build/UnityLoader.js                              ← loader; leave alone
Build/<name>.wasm.framework.unityweb.js           ← player glue; patch this
```

A Unity 5.x export puts the same glue somewhere else: `Release/<name>.js`, beside
`Release/<name>.asm.js`, `<name>.mem` and `<name>.data`, loaded by
`Release/UnityLoader.js`. It is an asm.js build rather than a wasm one, but the
file to patch and the two sites inside it are the same — see
[section 6.6](#66-the-asmjs-era-layout).

The framework file is minified onto a handful of enormous lines. Find the two
spots by searching for these markers:

```bash
grep -o 'FS.mount(IDBFS'        Build/*.wasm.framework.unityweb.js   # the mount
grep -o 'FS.syncfs'             Build/*.wasm.framework.unityweb.js   # the flush
grep -o '_JS_FileSystem_Sync'   Build/*.wasm.framework.unityweb.js   # the flush
```

Both patch points are exact string replacements. There are no line numbers to
follow — the file is minified onto a few enormous lines.

**The surrounding text differs by Unity version**, so grep for the *shape* of
the code, not for one exact snippet. Two variants are known to be in this
catalogue:

| | Unity 2018 (Snow Rider 3D) | Unity 2019+ (10 Minutes Till Dawn) | Unity 5.5 (Cluster Rush) |
|---|---|---|---|
| boot | `FS.mount(IDBFS,{},…)` then `FS.syncfs(true,…)` | identical | identical |
| flush call | `_JS_FileSystem_Sync()` | identical | identical |
| tick | `_JS_FileSystem_SetSyncInterval(ms)` | `_JS_FileSystem_Initialize()`, which registers the same timer itself via `Module.setInterval(…, fs.syncInternal)` | `_JS_FileSystem_SetSyncInterval(ms)`, as 2018 |
| `fs` literal | `sync:(…)` with `numPendingSync` | same, plus a `syncInternal` period field | same as 2018 |
| boot wrapper | bare `Module["preRun"].push(…)` | the same push, wrapped in an `if(typeof ENVIRONMENT_IS_PTHREAD==="undefined"||!ENVIRONMENT_IS_PTHREAD){…}` guard | bare `Module["preRun"].push(…)` |

Replace only the `push(...)` statement and leave any `ENVIRONMENT_IS_PTHREAD`
wrapper in place — it gates the whole filesystem step, not just this part.

**Builds split into `.partN` chunks.** 10 Minutes Till Dawn ships its framework
as `…wasm.framework.unityweb.part1` and its page merges the parts into a blob at
runtime. Patch the part file that *contains the glue*, not a file that does not
exist — `.part1` here is the whole framework.

### 6.3 Cut the IndexedDB persistence

Two replacement sites. In each, the parts being replaced only depend on
PluStore being on `window`, so the patch is the same for every Unity build; only
white space differs.

**Site 1 — the boot mount.** Find the `preRun` step that mounts IDBFS and
replaces it with a synchronous seed. This is the *original*:

```js
Module["preRun"].push((function(){var unityFileSystemInit=Module["unityFileSystemInit"]||(function(){if(!Module.indexedDB){console.log("IndexedDB is not available. Data will not persist in cache and PlayerPrefs will not be saved.")}FS.mkdir("/idbfs");FS.mount(IDBFS,{},"/idbfs");Module.addRunDependency("JS_FileSystem_Mount");FS.syncfs(true,(function(err){Module.removeRunDependency("JS_FileSystem_Mount")}))});unityFileSystemInit()}));
```

and this is the replacement:

```js
Module["preRun"].push((function(){var unityFileSystemInit=Module["unityFileSystemInit"]||(function(){var P=typeof window!=="undefined"&&window.PluStore;FS.mkdir("/idbfs");if(P)P.boot(FS,"/idbfs")});unityFileSystemInit()}));
```

Two things changed and both matter. `FS.mount(IDBFS, …)` and `FS.syncfs(true, …)`
are gone — `/idbfs` is now an ordinary in-memory directory. And the
`addRunDependency` / `removeRunDependency` pair is gone, because seeding from a
string is synchronous and needs no run dependency held open.

**Site 2 — the flush.** Find the `fs` helper and the two exported functions that
call it:

```js
var fs={numPendingSync:0,syncIntervalID:0,syncInProgress:false,sync:(function(onlyPendingSync){if(onlyPendingSync){if(fs.numPendingSync==0)return}else if(fs.syncInProgress){fs.numPendingSync++;return}fs.syncInProgress=true;FS.syncfs(false,(function(err){fs.syncInProgress=false}));fs.numPendingSync=0})};function _JS_FileSystem_SetSyncInterval(ms){if(!Module.indexedDB)return;fs.syncIntervalID=window.setInterval((function(){fs.sync(true)}),ms)}function _JS_FileSystem_Sync(){if(!Module.indexedDB)return;fs.sync(false)}
```

Replace it with:

```js
var fs={numPendingSync:0,syncIntervalID:0,syncInProgress:false,sync:(function(onlyPendingSync){var P=typeof window!=="undefined"&&window.PluStore;if(P)P.flush(FS,"/idbfs")})};function _JS_FileSystem_SetSyncInterval(ms){fs.syncIntervalID=window.setInterval((function(){fs.sync(true)}),ms)}function _JS_FileSystem_Sync(){var P=typeof window!=="undefined"&&window.PluStore;if(P)P.flush(FS,"/idbfs")}
```

Three details:

- **Both `if(!Module.indexedDB) return;` guards must go.** They gate on a
  capability probe the loader runs at startup. Leaving them in means the flush
  silently never happens in any browser where that probe fails.
- **`_JS_FileSystem_SetSyncInterval` must keep registering its interval.** That
  timer is the periodic save tick; only the gate in front of it was wrong.
- **The counter fields are kept but unused.** They tracked overlapping IDBFS
  syncs. `flush` is synchronous and deduplicates internally, so there is nothing
  to serialise.

`IDBFS` itself stays defined in the file. That is deliberate: it is unreachable
dead code once nothing mounts it or calls `FS.syncfs`, and deleting it is a much
larger, riskier edit for no benefit.

### 6.4 What the page then does

The game's own code changes not at all. `PlayerPrefs.SetInt("Best", 42)` in C#
still writes the same file at the same path; PluStore just owns where that file
lives:

```
boot   preRun → PluStore.boot(FS, "/idbfs")  → decode document → write PlayerPrefs bytes into memory
play   the player reads and writes /idbfs freely, entirely in memory
save   PlayerPrefs.Save()/_JS_FileSystem_Sync → flush → walk /idbfs → encode to text → backend
```

`flush()` walks the whole mount, re-reads every file, and writes only when the
produced text differs from the last document. There is nothing to configure: the
per-build MD5 directory name is whatever the player created, and the document
records the real paths it found.

### 6.5 Applying an imported save

Restoring happens at boot only, so an import is two steps — `PluStore.set(doc)`
and then reload the frame ([section 16](#16-inspecting-a-save)).

Both steps have to be inside the reload, because the running player is a writer:
its sync tick serialises its own in-memory tree over whatever is in the backend
about once a second, whatever you put there. Editing the document under a live
frame and *then* reloading is a race the tick wins. To test a save by hand, pin
the backend first (`PluStore.flush = function () {}`) or stop the frame, and only
then write and reload.

### 6.6 The asm.js era layout

Cluster Rush is a Unity 5.5 export: `Release/NG.js` (the glue), `NG.asm.js`,
`NG.mem`, `NG.data`, and `Release/UnityLoader.js` in place of the wasm-era
files. The glue is loaded by URL rather than inlined, so find the two sites with
the same greps as above and make the same two replacements; `fs`,
`_JS_FileSystem_SetSyncInterval` and `_JS_FileSystem_Sync` are all present and
all have the `if(!Module.indexedDB) return;` gate to remove. The mounting step is
identical, including the `unityFileSystemInit` wrapper.

Two things about this era are worth knowing before converting one.

**A two-argument `FS.writeFile` means "UTF-8 text" in this emscripten**, and a
typed array is not text. `FS.writeFile(path, bytes)` runs the array through
`stringToUTF8Array`, throws *after* it has created the file, and leaves a
zero-length file behind — `boot()` reported no error and restored nothing. The
shared adapter writes through a stream instead:

```js
function writeBytes(FS, path, bytes) {
  var stream = FS.open(path, 'w');
  try { FS.write(stream, bytes, 0, bytes.length, 0); }
  finally { FS.close(stream); }
}
```

`open`/`write`/`close` exists in every version in this catalogue and takes the
bytes as bytes, so this is the only form worth using. It was verified in both
directions on a Unity 5.5 build (a 64-byte binary and a text file with a tab and
trailing spaces, byte-exact through restore and flush) and on Unity 2018.

**The player carries its own telemetry, and it keeps it in the save.** Unity
5.5's analytics SDK is compiled into the player, endpoints and all: they sit in
`NG.mem` as `stats.unity3d.com/HWStats.cgi`,
`stats.unity3d.com/HWStatsUpdate.cgi`, `api.uca.cloud.unity3d.com/v1/events`,
`cdp.cloud.unity3d.com/v1/events` and `config.uca.cloud.unity3d.com`, and the
player calls them on its own schedule. Editing them out means editing the
compiled image. A
cache with no network access will fail those requests anyway, but do not let
them look like a broken conversion — Cluster Rush refuses them at the page level
with a small `XMLHttpRequest`/`fetch`/`sendBeacon` guard in `index.html`, the
same way [section 5](#5-removing-the-old-storage-method) refuses a remote engine
script.

The consequence for verification is that **a Unity 5.5 save is not empty after a
first boot.** The player writes `Analytics/config`, `Analytics/values` and one
`ArchivedEvents/…` directory into the mount before the game saves anything of
its own, so a document that appears on a clean install is the SDK's doing and not
a sign that an old save was migrated. Cluster Rush's own keys — `UnlockedLevel`,
`LEVEL`, `Cleared`, `S_Sound`, `StatsDone`, `SaveTime_Menu` — sit in the same
`PlayerPrefs` file as `unity.*` entries nobody asked for.

---

## 7. GameMaker HTML5

A GameMaker Studio 2 HTML5 export keeps its save in `localStorage`, but not
under the game's own file names: every local file is one entry keyed
`<sanitised game guid>.<version>.<name>`. An `.ini` is one entry, a `.json`
another, and `file_text_*`, `ini_*`, `file_exists`, `file_delete` and the
`file_ensure_js` extension are all views onto that one flat map of name to
string. There is no filesystem to mount and no flush to hook, so this conversion
is smaller than the Unity one: each name becomes an `@file` block, and
`PluStore.files` is everything the runner needs.

`bacon-may-die` is the worked example. It keeps seven files: `items.json`,
`pig.ini`, `missions.json`, `mods_bmd_custom.ini` and three per-mode
`save_*.ini`.

### 7.1 Load PluStore before the runner

In the game's `index.html`, ahead of the runner script:

```html
<head>
  <script src="../../js/plustore.js"></script>
  <script>PluStore.configure({ game: 'bacon-may-die', filePrefix: 'BaconMayDiebySnoutUp.0.' });</script>
</head>
```

The runner starts on `window.onload` (`GameMaker_Init`), so a classic script tag
in the head is early enough. There is no boot hook to call, because nothing has
to be in place before the engine reads a file — a read is just a function call.
`filePrefix` is the host's own storage prefix; [section 7.5](#75-the-storage-prefix)
explains why it has to be named.

### 7.2 The four functions that are the whole file layer

Everything goes through `html5game/<Game>.js`, minified onto a handful of
enormous lines. The function names are minified and differ per build; the bodies
are what is stable. Find them by shape:

```bash
grep -o 'window.localStorage\[_794' html5game/*.js          # the only writer
grep -o 'window.localStorage\[_794(_uj6)\]' html5game/*.js  # the only reader
grep -o "localStorage\['removeItem'\]" html5game/*.js      # the only deleter
grep -o 'window.localStorage\[name\]' html5game/*.js       # the exists test
```

Four exact string replacements, each independent of the others. Only the
`localStorage` half of each body is replaced; the remote-file branches stay.

**Write.** The old body stores the file under the prefixed key:

```js
function _294(_Bz4,_Rf4){if(_Tj6){return false}else if(_694){try{window.localStorage[_794(_Bz4)]=_Rf4;return true}catch(_894){return false}}}
```

```js
function _294(_Bz4,_Rf4){try{return PluStore.files.write(_Bz4,_Rf4)}catch(_894){return false}}
```

**Read.** Both `file_text_open_read` and `buffer_load` come through here, so
the file map is the single source for the game's data:

```js
if(_Tj6){return null}else if(_694){
try{_yT3=window.localStorage[_794(_uj6)]}catch(_894){return null}if((_yT3==undefined)||(_yT3==null))return null}
```

```js
{
try{_yT3=PluStore.files.read(_uj6)}catch(_894){return null}if((_yT3==undefined)||(_yT3==null))return null}
```

**Exists.** `file_exists` and the internal `file_text_open_read` guard both call
this:

```js
if(_Tj6){return false}else if(_694){try{var name=_794(_uj6);if(window.localStorage[name]&&(window.localStorage[name]!==undefined)){return true}return false}
catch(_894){return false}}
```

```js
{try{if(PluStore.files.exists(_uj6)){return true}return false}
catch(_894){return false}}
```

**Delete.** `file_delete` and the `file_copy` helper both call this:

```js
function _mn(_Y84){if(_694){try{window.localStorage['removeItem'](_794(yyGetString(_Y84)));return true}catch(_894){return false}}return false}
```

```js
function _mn(_Y84){try{return !!PluStore.files.remove(yyGetString(_Y84))}catch(_894){return false}}
```

Two of those bodies wrap onto a second line mid-expression, and the snippets
above keep the wrap rather than closing it up as a single line. That is not
cosmetic: reproduce it in the replacement, or the vendored file gains two
spurious whitespace changes that a reviewer will stop to wonder about. The
runner's line count should be unchanged by the patch, and `git diff` should show
only these four sites — 3 lines changed, 3 inserted, for `bacon-may-die`.

**And the extension.** `file_ensure_js` lives in its own file,
`html5game/xph_file_ensure.js`, loaded by the runner as a script tag, and writes
to the same prefixed keys behind the runner's back. It writes a default only
when the key is absent, so the read-modify-write pair matches that:

```js
        if (localStorage.getItem(path) == null) {
            localStorage.setItem(path, content);
```

```js
        if (!PluStore.files.has(path)) {
            PluStore.files.write(path, content);
```

After the four replacements, `grep -c localStorage html5game/<Game>.js` still
finds three or four hits. They are capability probes (`('localStorage' in
window)`), the Chrome-packaged-app check, and a debug console's `hasLocalStorage`
test. None of them read or write a game file; leave them alone.

### 7.3 Semantics worth preserving on purpose

`PluStore.files` is not a thin `localStorage` wrapper, and two verbs differ on
purpose, because changing them changes the game:

- **`exists` is the value's truthiness, not the name's presence.** The runner
tests `window.localStorage[name] && …`, so a stored-but-empty file answers
`false` to `file_exists` while `read()` still returns `''`. `bacon-may-die`
stores two empty files (`missions.json`, `mods_bmd_custom.ini`) and its startup
logic depends on that distinction.
- **`has` is the presence test**, because `file_ensure_js` compares against
`null`. That is what makes `ensure` write an empty default exactly once.

`remove` returns `true` whether or not the name was there, matching
`removeItem`, which never complained about a missing key.

### 7.4 Whole-file writes, one document

Unlike Unity there is no flush to wait for: the runner writes a file when the
game closes it (`file_text_close`, `ini_close`) and `PluStore.files` serialises
the whole map to the document at that moment. In `bacon-may-die` that is seven
document writes per boot, at a document size of about 4.5 KB.

Reads are cached against the document text, so a boot that reads seven files
parses once and not seven times.

### 7.5 The storage prefix

The runner builds its keys as `<prefix><name>` through one helper, `_794(path)`,
where the prefix is `<sanitised guid>.<version>.` (`BaconMayDiebySnoutUp.0.` for
this build). The four primitives are handed the *bare* name and 
prefix it themselves; `file_ensure_js` is handed an already-prefixed name by its
GML caller. `filePrefix` normalises both, so the document is keyed by the file
names the game itself uses and the prefix never reaches the save.

It is one string in the page, and it is the one thing here that is coupled to
the build: a new game guid or version means editing that line. The alternative —
keying the document by the prefixed name — would put a guid and a build number
inside the save file.

It is only safe for an engine that is handed composed names and never enumerates
its own key space, which is this runner's shape. Fancade's player is the
counter-example: it walks `localStorage.key(i)` and rejects any key without its own
prefix, so stripping it there hides every file from the player while every direct
read still answers ([section 13.1](#131-the-engines-own-storage-in-two-layers)).

---

## 8. Construct 3 HTML5

A Construct 3 export keeps no files at all. Its save is two key/value stores,
created through `localforage.createInstance`:

| Store | Holds |
|---|---|
| `c3-localstorage-<project id>` | the LocalStorage plugin — the game's own keys |
| `c3-savegames-<project id>` | whole-game save slots, one JSON string each |

`<project id>` is `data.json` → `project[31]` (`ldz28jk2uv2f` for Big FLAPPY
Tower), which is exactly what the runtime appends to both names. There is no
mount to cut and no flush to hook: the stores ride as `@store` blocks and the
caller keeps the promise-shaped surface it was written against.

The id belongs to the *project*, not the game. Big FLAPPY Tower and Big Tower
Tiny Square 2 both report `ldz28jk2uv2f`, so both would have opened the same two
IndexedDB stores — a converted game inheriting the other's save. Under PluStore
they cannot collide: the store names stay exactly as the runtime asked for them
inside the document, but each game's document lives under its own slot.

### 8.1 Load PluStore before the runtime

In the page's `<head>`, before `scripts/main2.js`. That script is a module that
fetches the engine dynamically, so a plain classic script above it always wins
the race:

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'big-flappy-tower-tiny-square' });</script>
```

`game` alone is enough — the slot becomes `plu:text:<game>`. There is no
`filePrefix` here: store names already carry the project id.

### 8.2 Check whether the assets are local at all

Some exports are *preview* builds: they ship the engine and a `data.json`, but
`data.json` points every image, font, sound and loose JSON at the developer's
Construct preview host — a third-party machine that can be overwritten or die.
The wrapper page looks local because it proxies one file tree; the game is not
offline at all.

```bash
grep -o 'https\?://[A-Za-z0-9./_%:?=&#@+~-]*' games/<game>/data.json | sort -u | head
```

Big Tower Tiny Square 2 is one of these: **731** references to
`https://<id>.preview.editmysite.com/uploads/b/<id>/files/…`, plus five more
hard-coded in `main.js` and `c3runtime.js` (the engine script,
`dispatchworker.js`, `jobworker.js`, `data.json` itself and `box2d.wasm`). All
of them have to go local before any patch to the runtime can matter.

1. **Download what the prefix names.** Not just the URLs the file mentions:
   `fonts/`, `icons/` and `media/` appear as bare *base* paths, with the file
   names living in the font and audio lists. Build the list from both, then
   fetch `data.json`, the loose `.json` files, `images/`, `media/`, `fonts/`,
   `icons/`, plus `scripts/dispatchworker.js`, `scripts/jobworker.js` and
   `box2d.wasm` from `.../files/`.
2. **Delete the prefix.** Every URL becomes a path relative to the page, which
   is the form a proper local export already uses:

   ```python
   raw = raw.replace('https://<id>.preview.editmysite.com/uploads/b/<id>/files/', '')
   ```

3. **Prune the media variants that were never published.** `data.json` records
   more variants than were uploaded — mostly `audio/mp4` (`.m4a`) beside the
   `ogg`/`webm` for the same sound, none of which exist anywhere. The runtime
   picks the first supported type, so a dead variant is an invitation to a 404
   during load. Drop every variant whose file is not on disk, then check the
   whole reference list:

   ```python
   missing = [r for r in references(raw) if not os.path.exists(r)]
   ```

Two traps when judging the result:

- **The number after an image path is not the file size.** It is the
  *pre-export* size, so a downloaded PNG at 17 % of it is not corrupt — and the
  same sheet name in a sibling game is a different image entirely. Do not
  verify assets by size. If you want a signal, compare the frame rects the
  entry carries against the PNG's real dimensions, and expect a few apparent
  overflows even in a known-good game: a control run on Big FLAPPY Tower's own
  files flags nine.
- **A shared preview host is not a stable source.** One project's upload can
  overwrite another's file of the same name. Prefer a byte-exact copy from
  elsewhere in the repo when one exists: 56 of this game's sounds came from
  `big-flappy-tower-tiny-square` — same names, same bytes, same developer's
  shared sound library.

### 8.3 Make the engine local first, and check it

**Do this before anything else, and verify it.** A Construct export that was
being served from a CDN keeps the CDN copies of its own engine in
`scripts/main2.js`:

```js
window.c3_runtimeInterface = new self.RuntimeInterface({
  useWorker: !1,
  workerMainUrl: "workermain.js",
  engineScripts: [
    "https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>/scripts/c3runtime.js",
  ],
  scriptFolder:
    "https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>/scripts/",
});
```

That is not a fallback list — it is the engine script URL, resolved through
`new URL(engineScripts[0], baseUrl)`. While it points at the CDN the game boots
the *remote* `c3runtime.js`: the local patch never runs, IndexedDB keeps
working, and nothing looks broken. Both lines have to become local paths, which
resolve against the page's own directory:

```js
    engineScripts: [ "scripts/c3runtime.js" ],
    scriptFolder:  "scripts/",
```

Then confirm the two copies are the same bytes, so repointing changes only the
URL and not the game:

```bash
curl -s "https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>/scripts/c3runtime.js" \
  -o /tmp/cdn-c3runtime.js && diff /tmp/cdn-c3runtime.js \
  <(git show HEAD:games/<game>/scripts/c3runtime.js) && echo identical
```

These builds usually pull one more thing from a third host. In Big FLAPPY Tower
`Construct3CrazySDK.js` injects an ad SDK:

```js
sdkElem.src = 'https://sdk.enjoy4fun.com/v1/cg-sdk.js';
```

That file is a self-contained stub — `window.CrazyGames.CrazySDK` with inert
methods and no network calls of its own — so vendoring it is a copy plus one
line: `sdkElem.src = './cg-sdk.js';`. The vendored copy stays byte-identical to
what the CDN served; only the URL in the loader is edited.

### 8.4 Third-party plugins the engine injects

An export can reach for the network through a file the page never mentions. Big
NEON Tower's `index.html` has no remote scripts at all, and the game still
loaded one: the `GM_SDK` plugin inside `scripts/c3runtime.js` injects its own
script tag when the plugin is constructed. It is a single minified line in the
file, wrapped here and nowhere else altered:

```js
(function(a,c,d){var f=a.getElementsByTagName(c)[0];
 a.getElementById(d)||(a=a.createElement(c),a.id=d,
 a.src="https://cdn.jsdelivr.net/gh/st39/sdk@main/sdk.js",f.parentNode.insertBefore(a,f))})
 (document,"script","gamemonetize-sdk")
```

So grep the engine, not only the page:

```bash
grep -o 'https\?://[A-Za-z0-9./_%:?=&#@+~-]*' games/<game>/scripts/*.js games/<game>/*.js | sort -u
```

Big FLAPPY Tower's SDK could be vendored unchanged, because the file the CDN
served was itself a self-contained stub. This one is a real ad client, so the
offline copy is a stand-in — and the loader URL has to become a local path
rather than be deleted, because **deleting it breaks the game**. The plugin's
own guard is a substring test on a value that is not a string:

```js
ShowAd(){ var e=window.sdk; "undefined"!==e && "undefined"!==e.showBanner && e.showBanner() }
```

`"undefined" !== e` is true for an undefined `e`, so the guard passes and the
next property access throws. While the real SDK loaded, the bug could never
fire; drop the loader and the game dies on its first ad call.

`games/big-neon-tower-tiny-square/gmsdk.js` is the stand-in. It honours the
contract the plugin expects, which is worth reading out of the plugin rather
than approximating: the constructor installs `window.SDK_OPTIONS =
{ gameId, onEvent }` and runs its whole state machine off the events delivered
there — `SDK_READY` raises `sdkReady`, `SDK_GAME_PAUSE` sets `adPlaying`,
`SDK_GAME_START` clears it, and `COMPLETE` raises `adViewed` for five seconds,
which is exactly what the plugin's `PauseGame` / `ResumeGame` / `AdViewed`
conditions test. A stand-in that accepts the calls and announces nothing leaves
the game in its paused state; one that emits `SDK_GAME_PAUSE` then
`SDK_GAME_START` from `showBanner` / `showAd` keeps every condition where a
player would be.

One timing detail: the plugin assigns `window.SDK_OPTIONS` inside its own
constructor, which has not returned yet when the injected script executes, so
the stand-in announces readiness on the next turn (`setTimeout(…, 0)`) instead
of during its own evaluation.

### 8.5 Patch the two construction sites

Both stores are built in `c3runtime.js`, inside the localforage shim. Site one
is `createInstance`, which is how the runtime asks for either store:

```js
    createInstance(k) {
      if ("object" !== typeof k) throw new TypeError("invalid options object");
      k = k.name;
      if ("string" !== typeof k) throw new TypeError("invalid store name");
      if (self.PluStore && self.PluStore.stores) return self.PluStore.stores.instance(k);
      k = new e(k);
      return new g(k)
    }
```

Site two is the default instance, at the end of the same shim:

```js
  self.localforage = self.PluStore && self.PluStore.stores ? self.PluStore.stores.instance("localforage") : new g(new e("localforage"))
```

Four details are easy to get wrong:

- **The guard is on `self.PluStore`, not on a bare `PluStore`.** The same file
  also runs inside a Web Worker when the export uses one; that scope has no
  PluStore, and the worker has to keep the original path instead of crashing.
- **`createInstance` is enough for both stores**, because
  `c3-localstorage-…` and `c3-savegames-…` are the only names the runtime ever
  asks for. The patch also covers the default `localforage` object, so a user
  script calling it directly lands in the same document.
- **The surface is small.** `self.IStorage` and the save-slot code call exactly
  `getItem`, `setItem`, `removeItem`, `clear` and `keys`; the runtime also
  touches `ready()`, `IsUsingFallback()` and `disableMemoryMode()`.
- **`new e(k)` is the IndexedDB driver, and it is lazy.** Never constructing it
  is why `indexedDB.open` is called *zero* times rather than "writes nothing".

### 8.6 What the game then does through it

The runtime reads its save at boot — one `getItem('FlappySaveGame')` on the
LocalStorage store for this game — and writes when the game saves. A slot save
(`rt._DoSaveToSlot(name)`, the same call the Save/Load events use) writes one
large JSON string: **138 KB** for Big FLAPPY Tower, a useful stress case for a
save that is a single text field. Keys are sorted in the document and an
emptied store leaves no block, so the same save always serialises to the same
bytes.

The key is not always findable in the project's own files, and when it is not,
that is the fastest thing to learn about a build. Big NEON Tower's key is the
literal `SaveGame`, which greps in one second; Big Tower Tiny Square 2 reads and
writes exactly one key, `reduxSaveGame`, and that string
**never appears** in its `data.json` — it is built at runtime from a `gameName`
variable (`"redux"`) plus a suffix. Grepping the project data is still the
fastest way to find a key; when that comes up empty, wrap the store and watch
what the game asks for ([section 15](#15-verifying-a-conversion)).

### 8.7 Store values carry a type tag

| Tag | Value |
|---|---|
| `str` | string |
| `num` | number — `-0`, `NaN` and `Infinity` included |
| `bool` | boolean |
| `null` / `undef` | `null` / `undefined` |
| `date` | a `Date`, as its ISO string |
| `ab` / `u8` | `ArrayBuffer` / `Uint8Array`, as base64 |
| `json` | plain objects and arrays, when every leaf is JSON-safe |

Anything else — a `Map`, a `Set`, a `Float64Array`, a function, an object
holding a `Date` — is **refused**: `setItem` resolves without storing, and
`stats().lastError` says what and why. That is deliberate. A store holds
structured-clone data, so quietly writing `"[object Map]"` or the *string* `"3"`
produces a save that reads back as the wrong type — the same class of failure as
storing binary as UTF-8. Everything the codec accepts comes back out of
`getItem` exactly as it went in.

### 8.8 What the document holds

One `@store` block per store, one line per key: `c3-localstorage-<project id>`
carries the LocalStorage plugin's keys and `c3-savegames-<project id>` the save
slots. `PluStore.stores.names()` and `PluStore.stores.entries(name)` read them
back decoded, which is how the key names in
[section 8.6](#86-what-the-game-then-does-through-it) were found
([section 16](#16-inspecting-a-save)).

The project id is the one place a shared id shows up: three EO Interactive titles
— Big FLAPPY, Big Tower Tiny Square 2 and Big NEON Tower — carry the same
Construct project id `ldz28jk2uv2f`, so all three documents list the same store
names. Nothing mixes, because each game keeps its own document under
`plu:text:<game>`.

---

## 9. Construct 2 HTML5

A Construct 2 export keeps its save the way a Construct 3 export does — a
key/value store reached through the bundled **localforage** — so the adapter is
the same and the patch is one line. What earns it its own section is everything
else a C2 export carries: project data behind a hard-coded developer URL, an
empty canvas painted over the game's, and every input arriving through the
Touch plugin whether or not the device has a touchscreen.

`games/big-ice-tower-tiny-square` is the converted example. It had never worked
in a browser, and the reasons had nothing to do with storage — which is the
argument for localizing and testing a game *before* touching how it saves.

### 9.1 Load PluStore before the runtime

`2min.js` is jQuery 2.1.1, `runtimee.js` is the C2 runtime, and the runtime
needs jQuery, so the order is fixed:

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'big-ice-tower-tiny-square' });</script>
...
<script src="2min.js"></script>
<script src="runtimee.js"></script>
<script>jQuery(document).ready(function () { cr_createRuntime("c2canvas"); });</script>
```

Delete `sync.js`. Delete the service-worker registration too — the export calls
`window.C2_RegisterSW()` on boot, and a cache that outlives an edit is a lie:
the runtime only calls it if it exists, so removing the definition is enough.

### 9.2 Three things the export hides

**The project data has two URLs, and the wrong one wins.** `runtimee.js` selects
`data.js` on the developer's host unless the runtime is in its own preview mode:

```js
var e = "https://<developer host>/uploads/<id>/files/data.js";
if (this.MC || this.Sp || this.Sx || this.Rx) e = "data.json";
```

On a CMS host that URL does not return the project at all — it returns an
injected page script. The game then boots to nothing: no error, no scene, no
menu, because the loader parsed a CMS script as project data. Cut the branch so
`data.json` is the only path, and delete any `data.js` the download brought with
it. This is the reason the game "did not work", and no amount of storage work
would have fixed it.

**A second, empty `<canvas>` sits over the game's own.** The export emits two:
`#c2canvas` (the WebGL surface the runtime draws into) and a bare
`<canvas width=… height=…>` positioned absolutely on top of it. The overlay has
no context and no listeners, but it wins every hit test, so clicks land on a
dead element and the game never sees them. The menu is unclickable in any
browser until it gets `pointer-events: none` (or is deleted). Check for this on
any C2 export from a portal: `document.elementFromPoint()` in the middle of the
canvas should answer `c2canvas`, not `CANVAS`.

The same wrapper also carries the download's entry point, so keep its structure
— the `#c2canvasdiv` sizing, the `cr_createRuntime("c2canvas")` call and the
`visibilitychange` suspend/resume handlers — and change only what must change.

**The asset list is by name, not by path.** `data.json` records sounds as
`[["jump.ogg", 14690], …]` and the runtime fetches them from `media/`, images
from `images/`. Those `size` fields are the *pre-export* sizes, so they are not
a way to verify a download: the host recompresses uploads, and this game's
originals came back smaller than recorded. Resolve sounds the same way the
filesystem does — `media/<name>` — and prune variants no host ever published,
because a missing `.m4a` beside every `.ogg` is a 404 on the first play.

### 9.3 The patch: one localforage global

The runtime bundles localforage as a UMD module, and its tail is the whole
conversion:

```js
"object" === typeof exports ? exports.localforage = ud()
  : this.localforage = self.PluStore && self.PluStore.stores
      ? self.PluStore.stores.localforage("localforage") : ud()
```

C2's WebStorage plugin is written against the localforage **global**, in
node-style callbacks with no promise anywhere in it, which is the one API
`stores.localforage(name)` exists for. Two more sites are the runtime's own
save/load driver — compiled into every C2 build even when no event uses it —
which writes a `saves` object store in `_C2SaveStates` and falls back to
`localStorage["__c2save_" + name]`:

```js
function g(a, b, c, e) {   /* put state b under name a */
  if (self.PluStore && self.PluStore.stores) {
    self.PluStore.stores.instance("_C2SaveStates").setItem(a, b).then(c, e);
    return;
  }
  ...
```

and its read twin `e(a, b, c)`, plus the two `localStorage.getItem("__c2save_" + n)`
fallbacks, which become `self.PluStore && self.PluStore.stores ? "" : localStorage.getItem(…)`
so the old store is never read. No event in this build drives them — the slot
name comes from actions the export does not contain — but a dormant path that
still reads the old store is a save that silently disagrees with itself the day
a build does use it. Patch it, so a dormant path cannot read a store the document
does not own.

**If the export bundles a real localforage**, which C2 does whenever the
WebStorage plugin is present, then `stores.localforage()` must answer the same
calls the plugin makes and no more: `getItem`, `setItem`, `removeItem`, `clear`,
`keys`, `ready`, plus inert `setDriver`/`config`/`defineDriver`. Anything that
would have to *invent* an answer — `length`, `key`, `iterate` — throws, the way
the engine's own shim reports what it does not implement.

### 9.4 What the game then saves

The store is named `localforage`, which is the global's own name rather than a
project id: C2 predates per-project store names, so every C2 build on an origin
would share the slots if the document were shared. It is not shared — the
document is keyed `plu:text:<game>` — but that is worth knowing before
diagnosing "the wrong save loaded".

Keys are the game's own, and their shape is a per-title convention:

| key | tag |
|---|---|
| `TotalDeaths_keyhs` | `num` |
| `TotalJumps_keyhs` | `num` |
| `respawnX_keyhs`, `respawnY_keyhs` | `num` |
| `Gametime_keyhs` | `num` |
| `RescueTime_keyhs` | `num` |
| `Finishedstate_keyhs` | `str` |
| `KillTime_keyhs` | `num`, absent until the first rescue |

The eight values are written on the game's own auto-save (its controls text
says "Auto-Saves every 1…"), so on a fresh install the document appears within
seconds of pressing start, filled with defaults — `Gametime 0`, `TotalDeaths 0`,
`respawnX 128`, `respawnY 8896`, `Finishedstate "towerclimb"`. Values are
written as numbers and read back as numbers, which is worth checking rather than
assuming: no store in C2 is stringly-typed, and a save that comes back as
`"128"` is a different save.

### 9.5 Why the mouse looks dead, and what really drives a C2 menu

A C2 build can carry two input plugins, and this is the part that will waste an
afternoon if it is not known up front.

**The Touch plugin ignores the mouse.** Its handlers open with
`if (a.pointerType !== a.MSPOINTER_TYPE_MOUSE && "mouse" !== a.pointerType)`,
so a pointer event from a mouse is dropped on the floor — on every modern
browser, because they all support `PointerEvent`. What makes C2 mouse input work
anyway is a jQuery bridge registered in the same plugin's init:

```js
this.hN && !this.j.jc && (
  jQuery(document).mousemove(function (a) { d.Uy(a) }),
  jQuery(document).mousedown(function (a) { d.Ty(a) }),
  jQuery(document).mouseup(function (a) { d.Vy(a) })
);
```

`Ty` synthesizes a touch at the click point and runs the touch-start triggers;
`Vy` synthesizes the touch end and runs the tap logic. So a real mouse click
reaches the game as a **tap**, and the Touch object answers it.

That leaves four ways a *synthetic* input test lies to you:

- A synthetic `MouseEvent` has `which === 0`; the Mouse plugin records
  `this.Mm = a.which - 1`, so "left button" conditions see `-1`. A trusted click
  has `which === 1`.
- The Mouse plugin tracks the pointer position **only on move** (`this.hj`,
  `this.ij`). A trusted click with no preceding move tests where the pointer was
  last seen, which is not where it is.
- The Touch plugin's tap needs press and release inside 333 ms, at the same point
  (under 15 px of travel). Hold for 500 ms and the press becomes a **long press**,
  which cancels the tap — so "click and hold" is not a stronger test, it is a
  different gesture.
- **The title menu need not be mouse-driven.** For this game, a single `Space`
  keydown moves the camera off the menu and into the level — verified from a
  fresh load, one key, nothing else — while no click gesture I could synthesize
  started it, trusted or not, with the position tracked and the left button set.
  Try the keyboard before concluding input is broken.

What *is* worth asserting while testing is the plumbing, not the game's reaction
to it. All four of these held for this conversion, and each is one expression in
the page: `document.elementFromPoint()` at the centre of the canvas answers
`c2canvas`; the Touch plugin instance's `touches` array grows on mousedown (so
`Ty` ran) and empties on mouseup (so `Vy` ran); the point it recorded
(`this.Mi`, `this.Ni`) converts through the button's own layer into the button's
box; and `runtime.Ao(buttonType, x, y, false)` finds an instance there. Given
that, an unresponsive menu is the game's logic, not the harness's.

### 9.6 Verifying without being able to play

C2 has no `c3_callFunction`, and this game's save is driven by its own auto-save
and by menu items, so the way in is to observe the plugin instead of pressing
buttons. A temporary copy of the game page — `index.html` plus one script
inserted after the `PluStore.configure` line, before the runtime — wraps the
factory the runtime resolves its global from:

```js
var factory = PluStore.stores.localforage;
PluStore.stores.localforage = function (name) {
  var lf = factory.call(PluStore.stores, name);
  ['getItem', 'setItem', 'removeItem', 'clear', 'keys'].forEach(function (m) {
    var orig = lf[m];
    lf[m] = function () {
      var args = [].slice.call(arguments);
      var entry = { m: m, key: String(args[0]) };
      log.push(entry);
      return orig.apply(lf, args).then(function (v) { entry.result = v; return v; });
    };
  });
  return lf;
};
```

With that in place, one boot gives both directions at once, and neither needs the
menu:

- **The game's own read path.** It reported fifteen `getItem` calls for the eight
  keys, every one settling — which is also the honest check that the callback
  bridge works, since a plugin written for callbacks does not await promises.
- **The game's own write path.** Playing a few seconds by hand (or by key — this
  game's jump is `Space`) produced `setItem` calls, and `stats().storeWrites`
  rose with them: `Gametime`, `TotalJumps` and `respawnX`/`respawnY` all moved in
  the document as the character moved on screen.
- **The round trip.** Write distinctive values through the same callback API
  (`TotalDeaths 42`, `TotalJumps 777`, `Gametime 4242`, `Finishedstate "plutest"`,
  `respawn 4321/8765`), reboot, and read the log: the game's *own* reads come back
  with those exact values.
- **The control.** Clear the document and boot again. The game writes genuine
  defaults (`TotalDeaths 0`, `TotalJumps 0`, `respawn 128/8896`) — without this
  step, "my values survived" and "the game never read anything" look identical.

---

## 10. Godot 4 HTML5

A Godot 4 web export has no save code of its own to find: `FileAccess`,
`ConfigFile`, `ResourceSaver` and the engine's own log all go to one `user://`
directory, and the player mounts that directory with Emscripten's IDBFS. The
whole persistence layer is three functions in `<name>.js` — the emscripten glue,
which a shipped export minifies onto one line. Re-formatted:

```js
is_persistent: function () { return GodotFS._idbfs ? 1 : 0; },

init: function (persistentPaths) {
  ...
  GodotFS._mount_points.forEach(function (path) {
    createRecursive(path);
    FS.mount(IDBFS, {}, path);                                 // user:// is IndexedDB
  });
  return new Promise(function (resolve, reject) {
    FS.syncfs(true, function (err) { ... resolve(err) });       // pull it out
  });
},

sync: function () {
  ...
  return new Promise(function (resolve, reject) {
    FS.syncfs(false, function (error) { ... resolve(error) });  // push it back
  });
}
```

The engine reaches only two of those, as wasm imports: `godot_js_os_fs_sync`
calls `sync()`, and `godot_js_os_fs_is_persistent` reports `is_persistent()`.
The second one is the trap. It is what tells Godot that `user://` survives a
reload, and a player that answers "not persistent" stops asking to sync at all —
so a conversion that mounts memory and forgets the gate produces a save that is
never written and never wrong-looking.

`buckshot-roulette` is the worked example: a `/userfs` mount, 20 files, 371 MB.

### 10.1 Load PluStore before the player

In the page's own `<head>`, above the engine script. The mount is named because
Godot's is not Unity's:

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'buckshot-roulette', mount: '/userfs' });</script>
```

### 10.2 Make the export local first

The wrapper page proxied a jsDelivr folder with `<base href>` —
`gh/genizy/web-port@main/buckshot-roulette/` — and that copy is gone: jsDelivr
refuses that account, so nothing loads from it today. GitHub raw is the copy
that works, and the same folder.

The build is one `wasm` and one `pck`, each split for size:

| File | Parts | Total |
|---|---|---|
| `buckshot-roulette.pck` | 17 × 19.3 MB | 344,705,792 bytes |
| `buckshot-roulette.wasm` | 3 × 13.8 MB | 43,444,261 bytes |

Nothing needs writing to load them: the export's own `main.js` fetches every
`.partN`, merges them into blobs and swaps `window.fetch` so the loader sees a
single file. The repo already uses that convention (10 Minutes Till Dawn), so
keeping the part names is the whole job. Two things must still line up:

- **`GODOT_CONFIG.fileSizes`** records the *merged* sizes, and the loader checks
them as it loads. A missing or short part fails loudly, which makes this the one
place a truncated download cannot hide.
- **`<base href>` must go**, or every relative path resolves against the dead
  CDN. Once it is gone, the icon, splash and worklet scripts are local too.

### 10.3 Cut the IndexedDB persistence

Three edits in the glue file. All three are unique strings in the minified line.

**Site 1 — the gate.** Without this the engine never asks to sync:

```js
is_persistent:function(){return GodotFS._idbfs?1:0}
```

```js
is_persistent:function(){return GodotFS._idbfs||(self.PluStore&&self.PluStore.flush)?1:0}
```

**Site 2 — the mount and the seed.** The original mounts IDBFS and then pulls it
out of IndexedDB, holding a run dependency open while that happens because
`syncfs(true, …)` is asynchronous:

```js
GodotFS._mount_points.forEach(function(path){createRecursive(path);FS.mount(IDBFS,{},path)});return new Promise(function(resolve,reject){FS.syncfs(true,function(err){if(err){GodotFS._mount_points=[];GodotFS._idbfs=false;GodotRuntime.print(`IndexedDB not available: ${err.message}`)}else{GodotFS._idbfs=true}resolve(err)})})
```

The replacement mounts memory and seeds it from the document instead, and the
whole `syncfs` promise goes away — seeding from a string is synchronous, so
nothing is held open and no run dependency is needed:

```js
GodotFS._mount_points.forEach(function(path){createRecursive(path);if(self.PluStore&&self.PluStore.boot){FS.mount(MEMFS,{},path);self.PluStore.boot(FS,path)}else{FS.mount(IDBFS,{},path)}});if(self.PluStore&&self.PluStore.boot){return Promise.resolve()}return new Promise(function(resolve,reject){FS.syncfs(true,function(err){if(err){GodotFS._mount_points=[];GodotFS._idbfs=false;GodotRuntime.print(`IndexedDB not available: ${err.message}`)}else{GodotFS._idbfs=true}resolve(err)})})
```

**Site 3 — the flush.** The original push:

```js
sync:function(){if(GodotFS._syncing){GodotRuntime.error("Already syncing!");return Promise.resolve()}GodotFS._syncing=true;return new Promise(function(resolve,reject){FS.syncfs(false,function(error){if(error){GodotRuntime.error(`Failed to save IDB file system: ${error.message}`)}GodotFS._syncing=false;resolve(error)})})}
```

is replaced by one flush per mount point:

```js
sync:function(){if(GodotFS._syncing){GodotRuntime.error("Already syncing!");return Promise.resolve()}GodotFS._syncing=true;if(self.PluStore&&self.PluStore.flush){GodotFS._mount_points.forEach(function(path){self.PluStore.flush(FS,path)});GodotFS._syncing=false;return Promise.resolve(null)}return new Promise(function(resolve,reject){FS.syncfs(false,function(error){if(error){GodotRuntime.error(`Failed to save IDB file system: ${error.message}`)}GodotFS._syncing=false;resolve(error)})})}
```

Both `IDBFS` branches are left in the file on purpose: unreachable once PluStore
is present, and deleting them is a larger edit for no benefit. `deinit` needs
nothing — it unmounts the paths and closes `IDBFS.dbs` entries, which no longer
exist.

### 10.4 What the game then does

The game's own code changes not at all. A `ConfigFile.save()` in GDScript still
writes the same file at the same path; PluStore just owns where it lives:

```
boot   GodotFS.init → PluStore.boot(FS, "/userfs") → decode document → write files into memory
play   the player reads and writes user:// freely, entirely in memory
save   godot_js_os_fs_sync(0) → GodotFS.sync → flush each mount → walk → text → backend
```

**When the engine asks.** `sync()` runs when the player closes or renames a file
— which includes the log rotation Godot performs at startup. Two consequences
are worth knowing before verifying anything:

- On a **clean install** there is nothing to rotate and nothing to close, so the
document legitimately stays empty until the game saves something of its own. An
empty document in the first seconds after boot is not a broken patch.
- The **second boot** is usually the first loud flush, because the previous
  run's `godot.log` is renamed on the way in.

The worked example wrote its first real save when the options screen was left:
`user://buckshotroulette_options_12.shell`, a binary file, so the document holds
it as a `@base64` block (4.2 KB). The document also carries `logs/` and
`shader_cache/` entries the engine created itself, and it grew from nothing to
9,239 characters in one step.

That file is the round trip. The language chosen in OPTIONS (`Español`) came
back on the next boot — `EMPEZAR / OPCIONES / CRÉDITOS / SALIR` — from a save the
game could only have read out of the document.

The second worked example, Crazy Cattle 3D, keeps a **text** save instead —
`user://crazysavefile.tres`, a Godot resource with `saveunlockedlevels`,
`savename`, `beatlevels`, `round`, `win`, the two volume floats and `fullscreen`
in plain sight — and it is the easier one to check, because the game prints what
it read:

```
Loaded with name SilentEagle_16c424c8 and 1 unlocked levels   ← the game's own fresh save
Loaded with name PluStore Test Cow and 9 unlocked levels      ← the next boot, after the document was edited
```

Those two lines are the whole round trip in the engine's own words, and the name
is generated, so it cannot have come from anywhere but the save. Two details are
worth expecting. A **fresh install logs an error** — `Cannot open file
'user://crazysavefile.tres'`, then `Savefile not found; Initialising` — and that
is the game's own first-run path, not a broken mount. And this engine writes when
the *game* decides to: the Options screen here has a **Save** button, which is
the cheapest way to make the document move on demand.

### 10.5 Verifying a Godot conversion

The FS and the engine's sync entry are both closure-local, so the page cannot
reach them and neither can you. A temporary copy of the game page, with two
wrappers installed before the player loads, reaches both:

```html
<script>
  var boot = PluStore.boot;
  PluStore.boot = function (FS, mount) { window.__FS = FS; window.__mount = mount; return boot.apply(this, arguments); };

  /* The engine's sync entry is a wasm import, so it is only visible where the
     imports are handed over. */
  var real = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = function (src, imports) {
    for (var k in imports.env) {
      if (/^godot_js_os_fs_(sync|is_persistent)$/.test(k)) window.__fns[k] = imports.env[k];
    }
    return real.call(WebAssembly, src, imports);
  };
</script>
```

With those, the two directions are one call each. To watch a save:
`__FS.writeFile(...)`, then call the engine's own `__fns.godot_js_os_fs_sync(0)`
and read the document. To watch a load: put a file in the document, reload, and
read it back out of `__FS` — a text file, a nested directory and a 300-byte
binary all compare byte-exact, which is what says the `@base64` path works and
not just the `@text` one. Then the store itself: `indexedDB.databases()` returns
`[]`, and the only `localStorage` keys are PluStore's.

Unlike the Construct titles, this engine takes ordinary DOM input, so the game
can be driven for real: dispatch `mousemove`/`mousedown` on `#canvas` and
`mouseup` on `window` and the menus respond. Two practical notes — the title
menu is still animating for a while after boot, so take a screenshot at the
moment you click and aim from that, and the engine *reports* whether it consumed
a click (the wasm callback's return value), which is a precise hit test when a
click seems to do nothing.

Two console lines are worth recognising and ignoring:

- **`TypeError: func is not a function`.** The engine makes a fire-and-forget
  sync call with a null callback; the glue does `GodotRuntime.get_func(0)` and
  then calls the result. The flush has already happened by then. It is upstream,
  and the IDBFS build behaves the same way.
- **`SampleNode._pause … reading 'currentTime'`.** An audio exception in this
  build when the AudioContext is still suspended; unrelated to storage.

### 10.6 Reading the two Godot saves

Both decode without tooling. Buckshot Roulette's is binary —
`user://buckshotroulette_options_12.shell` arrives as a `@base64` block and starts
`f4 10 00 00 …`, with `setting_volume` legible inside it. Crazy Cattle 3D's is a
text resource, `user://crazysavefile.tres`, so its `name = value` fields are in
plain sight ([section 16](#16-inspecting-a-save)).

Two things a reader has to expect on a first run. The engine drops its own
shader-cache directories into the document, so counting `@dir` blocks is easier
than listing hashes. And whether a save can be edited as fields depends on the
file: a `.tres` resource and a `ConfigFile` are text, a `.shell` is bytes.

### 10.7 Localising a split export

Some of these exports were published as *parts* — `index.pck.part1..3`,
`index.wasm.part1..3` — with the page stitching them back together at load time.
Crazy Cattle 3D did exactly that, and its folder is over jsDelivr's package
limit, so **every** file in it, parts included, answers `403 Package size
exceeded the configured limit of 50 MB`: 128 bytes of apology where a 19 MB chunk
should be. The game could not load at all, and the page's own error path is what
said so.

The parts split on a fixed boundary (19,922,944 bytes — exactly 19 MB) rather than
by anything the engine knows about, so joining them is a concatenation. The check
is in the page the export ships:

```js
"fileSizes": { "index.pck": 42336176, "index.wasm": 43699190 }
```

Concatenate in order, compare the totals against those two numbers, and the
result is a stock Godot export: `index.pck` and `index.wasm` beside `index.html`,
which is what the engine asks for — `executable: "index"` makes it ask for
`<executable>.pck` and `<executable>.wasm`, and `locate_file` maps the audio
worklets to `<executable>.audio*.worklet.js`, so the two `index.audio*.worklet.js`
files in that folder are named for the executable and not for `godot`.

Nothing about the storage patch changes for a split export: it is
[section 10.3](#103-cut-the-indexeddb-persistence) exactly as it stands.

Keeping the split and pointing the merge at local paths would also have worked.
Joining once is better, because the shim it replaces intercepted `fetch` and
answered `index.pck` and `index.wasm` with a `setInterval` that polled for the
merged buffer **and could not fail**. A part that never arrived left every request
for that file waiting forever, with the loading bar frozen — a conversion that
hangs instead of reporting. A file asked for by name, which is either there or a
404, cannot do that.

### 10.8 An endpoint inside the engine

Crazy Cattle 3D POSTs every run to `crazycattle3d.io/api/highscores` and asks the
same host for updates, from inside the compiled engine: the URL is in
`index.wasm` and nothing in the page mentions it. There is no file to edit, so it
is refused at the page level, before `index.js` loads, the way the Cluster Rush
player is refused its telemetry ([section 6.6](#66-the-asmjs-era-layout)):

```js
var BLOCK = /(^|\.)crazycattle3d\.io$/;
```

with the usual three doors covered — `XMLHttpRequest`, `fetch` and
`navigator.sendBeacon` — so a local build neither reports the player off-machine
nor waits on a request that cannot succeed. The tell was in the game's own UI: the
Options screen prints **"Update fail!"** where a reachable host would print a
result. A refused request looks like any other failed request to the engine,
which is what an offline player saw anyway.

---

## 11. Web Storage (`localStorage`)

Some engines never touch a filesystem or a database. They keep their whole save
in `localStorage` — one key per save slot, one for a setting, a `clear()` that
wipes them — and Cookie Clicker is exactly that shape: `CookieClickerGame`,
`CookieClickerGameBeta`, `CookieClickerLang`, and `localStorage.clear()` when
the player asks to reset. A very large number of browser games look like this.

There is no engine file to patch here, because the browser *is* the engine. So
the storage area itself is replaced, before the game loads:

```html
<script src="../../js/plustore.js"></script>
<script>
  PluStore.configure({ game: 'my-game' });

  /* window.localStorage is now a Storage-shaped area over the document. */
  var storage = PluStore.installWebStorage();
  if (!storage) console.error('the save would not be ours');
</script>
<script src="main.js"></script>
```

`installWebStorage()` returns the area it installed — `getItem`, `setItem`,
`removeItem`, `clear`, `key`, `length` — or `null` if the browser refused the
swap, which is the one outcome a page must not ignore: a game that keeps writing
to the real `localStorage` looks like it saved while the document stays empty.
`PluStore.webStorage()` hands back the same object without installing it.

That area answers by *method*, and it also answers by *property* —
`localStorage['foo'] = 1` stores exactly what `setItem('foo', 1)` stores, and
reading it back is the same read. Both are real ways to use a Storage area and
some games only ever use the second ([section 11.6](#116-the-second-surface-localstoragekey)).

The area's keys ride in the same document as `@file` blocks, one block per key,
so the save is readable text in the document like every other conversion. Their
names are the game's own, and for a game that *enumerates* the key space — rather
than asking for keys it already knows — they have to stay that way
([section 13.1](#131-the-engines-own-storage-in-two-layers)). The
methods are defined non-enumerable, the way a real Storage has them on its
prototype, so `Object.keys(localStorage)` inside the game lists the game's own
keys and not the five method names.

### 11.1 Repair the area, not the call sites

Cookie Clicker touches `localStorage` in twenty places: five calls through its
own `localStorageGet`/`localStorageSet` helpers, and direct
`window.localStorage.getItem` / `.setItem` / `.clear` calls elsewhere. Both work
after the swap, and that is the argument for doing it this way. Editing the game
means twenty edits in 1.2 MB of vendored code that a future version re-imports
over, and any call site the edit misses keeps writing to the browser's store
where nothing will read it. One swap covers all of them, including the ones that
do not exist yet.

### 11.2 The trap: the document lives in `localStorage` too

The document itself is stored under `plu:text:<game>`, so a backend that resolves
`global.localStorage` when it is *called* will, the moment the shim is installed,
read and write through the shim — the document asking the shim for the document.
That is not merely slow, it is unbounded: every access recursed until the stack
ran out, the backend's own `try/catch` swallowed the resulting `RangeError` and
answered "no document", and the page ended up with the main thread pinned while
the game booted against an empty save.

PluStore now captures the browser's Storage once, at load, before any page script
can replace it, and the backend reads that capture rather than the global. The
order of a page's own scripts therefore cannot move where the document lives, and
a game that swaps its own storage cannot take the document with it.

### 11.3 What the game keeps, and where

| Key | What it holds |
|---|---|
| `CookieClickerGame` | the save: `escape(base64(<pipe string>) + "!END!")` — 3.9 KB at the start of a run, and it grows |
| `CookieClickerGameBeta` | the same key for the beta version; `Game.beta` is 0 in this build, so it stays empty |
| `CookieClickerLang` | the language code the game last loaded (`EN`), which is why a fresh save shows the language picker |

The save is base64, so a reader cannot tell progress from the document alone; the
game's own `base64.js` turns it back into its pipe-separated fields, and the
cookie count on the screen is the game's own answer for the rest
([section 16](#16-inspecting-a-save)).

**Core Ball**, the other Web Storage engine here, keeps exactly one key:

| Key | What it holds |
|---|---|
| `core-ball-level` | the level the game gives itself at boot, as digits — `"4"` |

One key and no enumeration is a property of this *game*, not of the area, and it
is worth stating because it is what makes the game look like it saves nothing:
its whole save helper is `window.localStorage[k] = v` and
`window.localStorage[k]`, two lines with no `getItem` or `setItem` anywhere, and
it writes on only two occasions — when a level is passed (storing the next one)
and when **RESET** is pressed (storing `1`).

### 11.4 The paths that had to go

- **The page's own switch.** Cookie Clicker decides everything remote from
  `LOCAL`, and in the original that flag is *derived*:
  `(App || !hostname || hostname === 'localhost' || hostname === '127.0.0.1')`.
  On the original host it is false, and false means CDN assets, an ad loader, the
  Facebook pixel, the update check and a herald fetch. Pinning `var LOCAL=true`
  is what makes the folder self-contained on any host, not just on a dev box
  where the derivation happened to agree with us.
- **The ads.** The Google ad loader, the adblock-detector stub, the ad slots and
  the Playsaurus backfill frames are gone. The little `if (LOCAL)` object that
  stubs `adsbygoogle` stays, because the game's layout code calls it, and the
  game's own `noAds` class — which it applies when `LOCAL` is true — is what lays
  the page out without the ad column.
- **The fonts.** The original page's `@font-face` rules point at the host's
  `/cf-fonts/` URLs and the Google Fonts link is commented out in the original;
  both are gone and the page falls back to its own stack.
- **The cookie store.** `document.cookie` is the game's *older* save method, and
  the code is still in the file: `WriteSave`'s "legacy system" branch writes the
  save into a cookie. It is dead code in this build, because
  `Game.useLocalStorage = 1` is hard-coded and never reassigned, so the
  localStorage branch always wins. The one *reachable* cookie path — the fallback
  `LoadSave` takes when the store holds no save — is cut, so a save can only ever
  come from the document. A fresh copy of the file from the mirror puts that
  reader back, the same way a re-downloaded Unity framework undoes a Unity
  conversion.

### 11.5 Verifying a Web Storage conversion

1. **The document appears, one block per key.** Click the cookie, let the game
   save, and `localStorage.getItem('plu:text:<game>')` holds `@file` blocks named
   after the game's own keys.
2. **The game's own store holds nothing else.** Inside the game page,
   `Object.keys(localStorage)` is `[]` (the shim's methods are non-enumerable) and
   `localStorage.getItem('<the game's key>')` returns the save — through the
   shim, which is the point.
3. **A value round-trips through the game, not around it.** Write a value the
   game will display — Cookie Clicker's `Game.bakeryName` — save with the game's
   own `Game.WriteSave()`, reload, and read it back in the game's own UI. The
   stronger version is playing the value into existence: the cookie count is on
   screen, so its survival across a reload is visible without asking the console
   anything.
4. **The control.** Clear the document and boot. The game must come back with
   fresh defaults (a new random bakery name and zero cookies), which is what
   proves the earlier values came from the document rather than from a cache.
5. **Nothing else is reachable.** `indexedDB.databases()` is empty and the page's
   network log is all loopback — for Cookie Clicker every request is an image,
   a script, a sound or `loc/EN.js` under the game folder.
6. **A game that saves by property needs the property test**, because every step
   above passes without it. Inside the game page, `localStorage['<key>']` must
   return the value rather than `undefined`, `Object.keys(localStorage)` must
   list the game's keys, and the *game* must move the document. Core Ball's
   RESET button is the cheapest exercise, because it stores `1`: put `9` in the
   document, boot, press RESET, and a document that read `9` must read `1` — a
   change the game made, to a value it cannot have conjured.

### 11.6 The second surface: `localStorage[key]`

A Web Storage area is reachable two ways and a game picks one. `getItem` and
`setItem` are one. The other is the one the browser's own area also offers: every
stored key is an **own enumerable property**, so `localStorage.foo = 1` and then
`localStorage.foo` is a complete save and load.

Core Ball uses nothing else. Its whole save helper is:

```js
setValue: function (k, v) { window['localStorage'] && (window['localStorage'][k] = v); },
getValue: function (k) { return window['localStorage'] ? window['localStorage'][k] : undefined; }
```

Against an area that only answered by method, that helper fails **twice and
silently**: every read is `undefined`, so the game restarts at level 1 forever,
and every write lands on a property nothing serialises, so the save looks like it
worked and is gone. Neither raises anything, which is the argument for the shape
of the fix — a key nobody declared cannot be intercepted by a plain object, so
the area is a `Proxy`. Read, write, `in`, `delete` and `Object.keys` all have to
speak for keys the object has never heard of.

Four of those behaviours are the browser's rather than a plain object's, and each
is something a game can notice:

| Behaviour | Why |
|---|---|
| a key that is not stored reads `undefined` | that is what a missing property is; `getItem` is the one that answers `null` |
| a method or `length` wins over a key of the same name | `prop in area` is true for those on a real Storage too, so a key called `key` is shadowed there as well |
| assigning stores the *string* | `localStorage.n = 3` reads back `"3"`, exactly as the browser does |
| `Object.keys()` lists the stored keys and not the methods | the methods are non-enumerable, as they are on the real prototype |

A browser without `Proxy` gets the bare method surface. Degrading beats throwing:
an area that raised where the game used to work would take the page down with it.

Both surfaces are views of the same `@file` blocks, so they cannot drift — a key
written through one is readable through the other, in the same tick and in the
document.

## 12. YouTube Playables (`ytgame`)

Some games do not own their storage at all. They are built for a host platform and
save through the host's SDK: Crossy Road's save *is* `ytgame.game.saveData(...)`,
and its load is a scatter of `getYTCloudItem(key, default)` calls that parse that
blob back. The SDK is the engine, and it is the hardest case in this document,
because **it cannot be loaded at all** outside YouTube.

### 12.1 What the SDK does when there is no host

Nothing here is PluStore's doing; it is what the vendored SDK does, read out of
the published `ytgame.js`:

- `IN_PLAYABLES_ENV` is `window !== window.parent`. Not a capability check, not a
  handshake — *being in a frame at all*. A top-level tab is "not Playables"; any
  frame at all is.
- Every data method is gated on it. Top-level, `loadData()` resolves `""` and
  `saveData()` does nothing, so a game's save goes in the bin with no error
  anywhere. Framed, the same calls post a message to a parent that is not there
  and wait for an answer that never comes, so the game hangs on the load instead.
- Having decided it is embedded, it redefines `window.localStorage`,
  `sessionStorage`, `indexedDB`, `caches` and `document.cookie` as **null**, to
  force games onto its own API. A game that keeps a local fallback for the
  not-embedded case loses that fallback too.

So loading it is wrong both ways, and not loading it is worse: `saveGameData()`
calls `ytgame.game.saveData(...)` with no guard, so the first save throws. Write a
local stand-in.

### 12.2 The local stand-in

[`games/crossy-road/ytgame-local.js`](games/crossy-road/ytgame-local.js) is the
whole of it — the same object shape, backed by PluStore, loaded before the game:

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'crossy-road' });</script>
<script src="ytgame-local.js"></script>
```

Two decisions in it are worth copying rather than rediscovering:

- **`IN_PLAYABLES_ENV: true`.** The game carries both paths — the SDK one and a
  local `crossyStorage` one — and only one can be live, because they do not share
  a namespace: `saveGameData()` always writes the SDK's single JSON blob, while the
  local getters read thirteen separate keys. Take the SDK path and the local one
  becomes dead code (39 `crossyStorage` calls, every one of them in the `else`
  branch of an `if (ytgame?.IN_PLAYABLES_ENV)`); take the other and the game reads
  a store it never writes.
- **The blob is one `@file` block.** `loadData`/`saveData` *are* the save read and
  the save write, so they go through the Web Storage area
  ([section 11](#11-web-storage-localstorage)) under one key, `ytgameGameData`:
  one document, one mechanism, one inspectable save — and if a future build does
  reach the game's own local fallback, that lands in the same document instead of
  in the browser's store.

Only the members this build touches are defined — `game.loadData`,
`game.saveData`, `game.gameReady`, `game.firstFrameReady`,
`system.isAudioEnabled`, `system.onAudioEnabledChange`, `engagement.sendScore`.
A game that reaches for more should extend that list rather than load the SDK.
Two of the seven have a shape worth noting: `system.isAudioEnabled()` is
**synchronous and boolean** (the game assigns it straight into a flag, and the
SDK's own answer with no host is `true`), and `engagement.sendScore()` resolves,
saying once in the console that scores stay local, because the leaderboard is
YouTube's and there is nowhere to send them.

### 12.3 The trap: the game's own load path may be dead code

This is the part that very nearly passed as a working conversion. The saves
appeared, the document filled in, the console was quiet — and the game still
started every session at zero progress, because nothing ever read the blob back:

```js
window.start = function() {
	//window.StartInitLoader.add(loadYTCloudGameData);    ← the only reference left
```

That commented line is the game's own bulk load, and every other mention of
`loadYTCloudGameData` in the file is commented out too. So `Game.topScore`,
`Game.coins`, `Game.unlockedCharacters` and the other ten fields were never
seeded, they sat at their JS defaults, and each of the game's five
`saveGameData()` call sites wrote those defaults back over the save — a high score
erased by the next boot, and `doUnmute`'s save erasing everything except the two
fields it passed in. Uncommenting that one line fixes all of it.

**A conversion is not done when the save appears. It is done when a value
survives a reload.** Through the document, a store the game writes but never
reads looks exactly like a working one.

### 12.4 Removing the old method

- the `<base href>` pointing at the CDN folder, which went on redirecting every
  relative path in the page;
- the SDK's `<script>` from that CDN, and the file itself — deleted from the
  folder, not just unlinked, so it cannot be re-imported by habit;
- `js/sync.js`;
- the game's own non-Playables branches, left in place but unreachable
  ([section 12.2](#122-the-local-stand-in)). They cost nothing dead; cutting them
  would be 39 edits into 1.2 MB of vendored minified code.

### 12.5 Two more things this build shipped with

Both are worth knowing before you trust a console on any of these games:

- **`game.min.js` was in the page twice.** The wrapper's `<head>` loaded it, and
  the game's own loader queues it as an asset once its loading screen is up
  (`AssetLoader.add.script('scripts/game.min.js')` in `bootstrap.min.js`). The
  second evaluation died on `let isYouTubeAudioEnabled has already been
  declared` — a `SyntaxError` on every single load, harmless only because the
  first copy was already live and holding the game's functions. The head copy is
  the redundant one: the loader only calls `window.start()` from its queue's
  completion, so the game script is guaranteed to be evaluated before anything
  uses it. It existed because YouTube's CSP would have blocked the loader's own
  injected tags without a nonce; there is no CSP to satisfy locally.
- **The audio path assumed a manager that did not exist yet.** `Game.audioManager`
  is built when the logo animation finishes, while the audio check runs 800 ms
  after startup, so roughly every other load reached `doUnmute()` with it still
  null, threw a `TypeError`, and took the rest of the function — including its
  save — with it. Which of the two outcomes you got was a race, which is how the
  *save* came to be wiped on some boots and not others. Both call sites are
  guarded now, which is what the author's own commented-out `if` above one of them
  intended.

### 12.6 What the game then does

- **Reads** one `loadData()` per `getYTCloudItem()`, which is 13 at boot from the
  bulk loader plus one for the coin HUD through `GameSave.GetCoins()`. Fourteen
  reads, then the first write.
- **Writes** `saveData()` with the game's whole thirteen-field object: on a new
  high score, on the tutorial and carousel flags, on a gumball prize, on a coins
  change, on a sound toggle. Each write **replaces** the block, which is only safe
  because `saveGameData()` always serialises all thirteen fields from `Game.*` —
  and therefore only safe while [section 12.3](#123-the-trap-the-games-own-load-path-may-be-dead-code)
  holds. A host SDK's `saveData` replaces too, so the same fragility is on the
  real platform; nothing here introduces it.

### 12.7 Reading the blob

The save is one `@file ytgameGameData` block, and the JSON inside it is the
game's whole state: thirteen fields, `topScore`, `coins`, `unlockedCharacters`
and `currCharacter` among them. Parsing it is the fastest way to see a field the
game has not read or written back yet, which is also why a save that is written
whole can look perfectly healthy while the game is writing defaults over it
([section 12.3](#123-the-trap-the-games-own-load-path-may-be-dead-code)).

### 12.8 Verifying a Playables conversion

The generic five steps in [section 15](#15-verifying-a-conversion) all apply. This
game adds two that are specific to a host SDK, and both are cheap:

1. **Count the reads and the writes, in order.** The save is written whole, so a
   write built from a state that was never loaded is invisible in the document
   after the fact — it is a perfectly well-formed blob, just the wrong one. A
   temporary two-line log in the stand-in's `loadData`/`saveData` settles it in
   one boot: *fourteen reads, then one write* is a game that read its save;
   *one read, one write* is a game that wrote over what it never looked at, and
   the write's payload is printed next to it.
2. **Seed a save, boot, and check the game's own variables.** Not the document —
   `iframe.contentWindow.Game.topScore` and its neighbours, i.e. what the game
   believes. Editing the stored blob to `topScore: 777, coins: 300,
   unlockedCharacters: [0, 1], currCharacter: 1` and reloading is the test; the
   same values in `Game.*` afterwards, with nothing in the console, is the proof.

One thing that looks like a fault and is not: a bare `@file test` block holding
`0`. That is the game's own `localStorage` helper checking it has storage at all
(`localStorage.setItem('test', 0)`), landing in the document like any other
write. It carries no save data. It is also evidence that the Web Storage area
succeeded — without it, that probe would have been a write to the browser's real
store.

---

## 13. Fancade (Poki)

`games/drive-mad/` — a Fancade web player, wrapped for Poki. Two things make it
different from every conversion before it: the player loads its save by
*enumerating* the key space it was given, and the page would not run at all until
something in it was *removed*.

### 13.1 The engine's own storage, in two layers

The player keeps its database in `localStorage`, one base64 blob per path:

    com.martinmagni.drivemad/data/sandbox/db        the save
    com.martinmagni.drivemad/data/sandbox/db.bak    the player's backup
    com.martinmagni.drivemad/data/sandbox/db.lod    and its second
    com.martinmagni.drivemad/version                "this database was migrated"
    startup-time                                    which tab loaded last

`webapp/source_min.js` is that whole layer, and it is small:

    Storage.init(path_max)   migrate0(); sync(); write the version stamp
    Storage.sync()           walk localStorage.key(i), hand each stored file to the player
    Storage.write(...)       put(PREFIX, path, data) → setItem
    Storage.remove(...)      removeItem(PREFIX + path)

Every call is already `localStorage`, so this is a Web Storage conversion
([section 11](#11-web-storage-localstorage)) and the page installs the area before
the player loads:

    PluStore.configure({ game: 'drive-mad' });
    var storage = PluStore.installWebStorage();

**The prefix must not be stripped here**, and this is the one thing about this
engine that is easy to get wrong, because everything else about it still works when
you do. `sync()` is the only path by which the browser's stored files reach the
engine — `init()` calls it once, before `app_init` — and it begins by enumerating
the key space and **skipping anything that does not begin with the player's own
prefix**:

    for (let i = 0; i < len; i++) {
      key = localStorage.key(i);
      if (key === null || !key.startsWith(Storage.PREFIX)) continue;   // the gate
      path = key.slice(Storage.PREFIX.length);
      data = Storage.get(Storage.PREFIX, path);
      if (data === null) continue;
      _storage_write(path_ptr, data_ptr, data_len);                     // the engine
    }

Configure the area with `filePrefix: 'com.martinmagni.drivemad/data/'` and every
key it stores loses exactly that prefix, so `key(i)` answers `sandbox/db`, which
does not start with it. The gate rejects every key, the loop completes having
pushed nothing, and the player boots with no database at all: the game reports that
it could not load its progress, on every boot, however healthy the document looks.
Nothing else notices. The document is complete and readable, `Storage.get(prefix,
path)` still answers — that call composes the prefix itself, and the area strips it
again — `PluStore.stats()` is clean, and there is no error anywhere to follow. The
only visible sign is the player's own message.

So the area keeps the player's key space, and the document is keyed by the names
the player itself looks for: `com.martinmagni.drivemad/data/sandbox/db` and its two
siblings. `com.martinmagni.drivemad/version` and `startup-time` keep their own names
as well; neither carries the data prefix, so the same gate skips them, and they are
not files the player loads.

`filePrefix` is a display convenience, and [section 7.5](#75-the-storage-prefix) is
the case where it is safe: a GameMaker runner is handed fully-composed names by its
own `_794()` helper and never lists anything back. An engine that walks its own key
space has to keep that key space intact — what decides is the enumeration, not the
engine.

The second layer is the player's own filesystem: the build mounts one at `/sandbox`
and seeds it from the document before `app_init`. That seeding is not how the save
is loaded (the engine gets it through `_storage_write`), and with the player's own
key names it does not even land in the mount — a block named
`com.martinmagni.drivemad/data/sandbox/db` is written as a *relative* path, so it
resolves against the filesystem root
([section 13.4](#134-a-block-and-its-file-can-be-one-file)).

A document written while the prefix *was* stripped keeps its `sandbox/db` blocks.
They are inert — the boot gate ignores them — and they are worth clearing once, but
nothing breaks if they stay: the next flush drops the mounted copy of each one
([section 13.4](#134-a-block-and-its-file-can-be-one-file)), so the cost is a stale
row in the save until the game next writes.

### 13.2 Load PluStore before the player

`games/drive-mad/index.html` is small: PluStore and its configuration, the local
Poki stand-in, then the player's own two scripts. The page that shipped was a
wrapper — its assets came from a jsDelivr folder and its SDK from a Poki CDN — so
localising it was part of the job, and the copy was taken from the host the wrapper
itself pointed at (the Poki package URL recorded in the wrapper's own shim) with
every file verified against its content hash.

    <script src="../../js/plustore.js"></script>
    <script>
      PluStore.configure({ game: 'drive-mad' });   /* no filePrefix — see 13.1 */
      var storage = PluStore.installWebStorage();
      if (!storage) { console.error(...); }
    </script>
    <script src="poki-local.js"></script>
    ...
    <script type="text/javascript" src="webapp/source_min.js"></script>
    <script type="text/javascript" src="webapp/index.js"></script>

The `webapp/` folder is otherwise stock: `index.js` (the wasm glue),
`index.wasm`, `index.data` (the player's assets), `source_min.js` (the shell),
`fancade.css`, `cover.jpg`, `baloo2.woff`. All of them are local; a full boot makes
no request that is not `127.0.0.1`, and the only 404 is the browser's own probe for
a favicon the page does not have.

### 13.3 The three sites, and the callback that must actually run

This build's glue is *unminified*, which makes the three sites easy to find and
easy to get subtly wrong. They are three entries in the player's command table,
the same table that carries `hideOverlay()`, the audio calls and the storage
verbs:

| Command | Was | Is |
|---|---|---|
| mount + `app_init` | `FS.mkdir("/sandbox"); FS.mount(IDBFS, {}, "/sandbox"); FS.syncfs(true, cb)` with `app_init()` and `hideOverlay()` in `cb` | `FS.mkdir; FS.mount(MEMFS, {}, "/sandbox"); PluStore.boot(FS, "/sandbox");` then `app_init()` and `hideOverlay()` directly |
| sync to storage | `FS.syncfs(false, cb)`, `fsSyncStatus` cleared in `cb` | `PluStore.flush(FS, "/sandbox")`, guard cleared in the same tick |
| sync from storage | `FS.syncfs(true, cb)`, same guard | `PluStore.boot(FS, "/sandbox")`, same guard |

The trap is the callback. `FS.syncfs` takes one; `PluStore.boot` and
`PluStore.flush` are synchronous and take none — so a conversion that replaces the
call and leaves the callback behind produces a parenthesised function expression
that nothing invokes:

    PluStore.boot(FS, "/sandbox");(function (err) { ... app_init(); hideOverlay(); })

The mount happens, the tree is seeded, and then the game sits on its loading screen
for ever: `app_init` is never called, `Module._get_app_inited()` stays 0, and
nothing throws, which is what makes it worth calling out. The same shape did worse
to the two sync commands, where the guard is cleared *inside* the old callback: it
stayed set for the life of the page, so every later sync request was refused
without a word.

Both callbacks' bodies now run directly, and the guard clears in the same tick as
the operation it guards. Nothing is lost by that: with a synchronous backend there
is no window in which a second sync could overlap the first, which is the only
thing that guard was ever for.

### 13.4 A block and its file can be one file

`readTree()` names a file by the path it walked to (`/sandbox/db`), while a hosted
block keeps whatever key the engine asked for. `restoreTree()` writes a block's
name as a path, and a *relative* name resolves against the filesystem root — so the
two names only collide when the host's spelling of a key resolves into the mount:

    @file sandbox/db                                → /sandbox/db, inside the mount
    @file com.martinmagni.drivemad/data/sandbox/db  → /com.martinmagni…/sandbox/db

While this page stripped the prefix — [section 13.1](#131-the-engines-own-storage-in-two-layers)
is why it no longer does — the save *was* the first spelling, so the seed landed
exactly on the player's own `/sandbox/db`. A flush walks the mount and carries the
hosted blocks into the same document, so it wrote the save twice, and once written
the next boot seeded the mount from both blocks and the flush after that wrote both
again. Nothing was lost, but the save was in the document twice for good, and a
listing showed two rows for one file.

With the player's own key names the seed lands outside the mount and there is
nothing to collide. `flush()` still drops a tree file whose mounted path a hosted
block already names ([section 18](#18-reference) for the API), because the
collision is a property of any host whose block names resolve inside the mount
rather than of one configuration: a tree file with no hosted block behind it — the
file that is only a file — is still written, and for an engine with no hosted
blocks at all, which is every Unity and Godot conversion, the filter has nothing to
drop and behaves exactly as before.

### 13.5 The Poki SDK — and the sitelock that had to go

The build cannot start without a Poki SDK. Its boot is
`PokiSDK.init().then(setPokiInited)`, `setPokiInited` calls `gameLoadingStart()`
unguarded, and the game only starts once `PokiSDK.commercialBreak()` resolves —
which is also what `adInterstitialShow()` uses, so an SDK that never resolves that
promise holds the loading screen for ever.

`games/drive-mad/poki-local.js` is the stand-in, and it is exactly the surface the
build reaches for: `init`, `gameLoadingStart`, `gameLoadingFinished`,
`gameplayStart`, `gameplayStop`, `commercialBreak`, `rewardedBreak` — seven
members, checked against every `PokiSDK.` reference in the build.
`commercialBreak()` resolves at once (there is no ad to watch, and refusing to
resolve would freeze the boot); `rewardedBreak()` resolves `false`, the same answer
the real SDK gives when it cannot fill an ad. Vendoring the published
`poki-sdk.js` would not have been localisation: it is a loader that injects
`https://game-cdn.poki.com/scripts/<version>/poki-sdk-<device>.js` at run time.

The name that matters more is `pokiSendLevelData()`, whose body used to post a
beacon to `leveldata.poki.io` on every level completion; it is a refusal now, the
same treatment the other engines' score endpoints get.

**The sitelock.** `initPokiSdk()` opened with an obfuscated IIFE, and an obfuscated
IIFE in a build shell is worth decoding before it is trusted. Its strings are
base64: `localhost`, `.poki-gdn.com`, `https://download.poki-gdn.com` and
`https://poki.com/sitelock`. It read `window.location.hostname`, allowed
`localhost` and any `*.poki-gdn.com` host, and otherwise navigated the page — and
the top frame with it — to `https://poki.com/sitelock`, which answers with Poki's
"game not available" page.

Served from `127.0.0.1` that is exactly what happened: the game fetched its
assets, booted its player, logged its own startup lines, and was then replaced by
Poki's error page. The desktop preview had only *hidden* it, by cancelling the
cross-origin navigation, which is the worst way for a fault to present — the
conversion looked finished, and the two aborted requests were the clue. It is
removed whole rather than answered locally: there is no response that means
"allowed" short of the hostname check itself, and a check that protects Poki's
catalogue from re-hosting has nothing to say about a folder on a player's own disk.

### 13.6 What the player then does

A cold boot, in order: the page installs the Web Storage area, `poki-local.js`
answers `init()` and `commercialBreak()`, the player's `postRun` sets
`postRunDone`, `tryStartGame()` finds all three flags and calls `startGame()` —
which registers the listeners and tells the player the user has accepted. The
player then asks JS for the mount, gets `PluStore.boot(FS, "/sandbox")`, calls
`app_init()`, and hides the loading screen.

Two writes are already in the document by then, and neither is the save:
`Storage.init` writes the version stamp, and `set_latest_browser_tab` writes
`startup-time` — both under names that do not carry the data prefix, so they appear
in the document as themselves. `Storage.sync()` also reads every stored path and
hands it to the player before the game draws anything.

Then the game plays, and the save arrives: `Storage.put()` base64-encodes a
database blob and calls `localStorage.setItem`, which the area turns into a block.
The blob is **zlib-compressed JSON** — `{"v":6,"om":1,"os":1,"gc":{...}}` — so the
document holds text, and the text is base64 of a compressed stream — so reading it
means inflating it first ([section 16](#16-inspecting-a-save)).

### 13.7 Applying a save from outside

Changing this document from outside the player is two steps — write it, then start
the player again — and the order matters, because the player is a writer: Fancade's
shell flushes the whole mount when its page goes away, so clearing or replacing the
document while an old player is still alive lets its dying flush put the old save
straight back. Park the frame on `about:blank` (which unloads the player and lets it
finish), change the document once it is gone, and only then start the game again
([section 19](#19-known-limits)).

The values that say whether any of it worked are the player's own:
`Module._get_app_inited()`, and what the frame's `Storage.get(Storage.PREFIX, path)`
answers for the path that was written ([section 13.8](#138-verifying-a-fancade-conversion)).

### 13.8 Verifying a Fancade conversion

The player is a wasm app with its own notion of "inited", and almost all of its
state is inside the wasm, so the checks that work are the ones the player and the
engine report about themselves:

- **What the boot handed the engine.** This is the check that matters, and the one
  a direct read cannot replace, because `sync()` is the only path from the document
  into the player. Wrap it for one boot and log the keys it accepts:

  ```js
  var orig = Storage.sync;
  Storage.sync = function () {
    window.__paths = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(Storage.PREFIX) === 0) window.__paths.push(k.slice(Storage.PREFIX.length));
    }
    return orig.apply(this, arguments);
  };
  ```

  A boot with a save in the document must list `sandbox/db` and its siblings. An
  empty list beside a full document is
  [section 13.1](#131-the-engines-own-storage-in-two-layers): the prefix, not the
  data.
- `Module._get_app_inited()` — 0 means the mount or `app_init` never ran. This is
  the single most useful value in this engine: the loading screen looks the same
  whether the game is booting or dead.
- `PluStore.stats()` — `booted` counts the mount's seed, `flushed` the writes back,
  and `fileWrites` the game's own `setItem`s.
- `Storage.get(Storage.PREFIX, path)` in the frame — the engine's own read path,
  which decodes exactly what the document holds. It proves the document is
  readable, and *not* that the player was given anything: that call composes the
  prefix itself, so it answers even when the boot loop accepted nothing.
- the area's keys, via `Object.keys(localStorage)` in the frame: they are the
  document's blocks, so a game that "saved" without writing is visible as an empty
  list.

A file the game has never written is worth injecting, because it comes back only if
the boot loop passed it: add
`@file com.martinmagni.drivemad/data/sandbox/probe-file` holding `aGVsbG8=` — base64
for `hello` — reload, and ask the player for it through
`Storage.get(Storage.PREFIX, 'sandbox/probe-file')`. It answers `hello` when the
area and the engine agree on the key space, which is the check that catches a
stripped prefix.

---

## 14. Flash (Ruffle)

`games/duck-life/` and `games/duck-life-2/` are Flash builds — one `.swf` each,
played by Ruffle, a WASM Flash player. Nothing inside a movie is patched — this
is the shortest conversion in the document — but two things about Ruffle are not
obvious: the key its saves are named by, and the fact that its save is already
`localStorage`. The second game is written up alongside the first because it
taught one thing the first could not ([section 14.9](#149-what-the-second-conversion-added)):
a movie may not open its save at all until the player starts the game.

### 14.1 The save is a SharedObject, and Ruffle's backend is localStorage

Flash's save is a `SharedObject`: a movie calls
`SharedObject.getLocal("mydata")`, keeps state in `.data`, and writes it with
`.flush()`. Duck Life's whole save is that one object —

    stalvl  runlvl  flylvl  swilvl  seed  skill  money  colour  hat

— and Duck Life 2 keeps the same names and adds four more:

    stalvl  runlvl  flylvl  swilvl  seed  skill  money  colour  hat
    maxi  maxmaxi  clilvl  namee

Both are `getLocal("mydata")`, so both land in the document under the *same*
slot name and are kept apart by the movie part of the key only. That the second
list is right is not inferred from the bytes: the movie's own constant pool
spells out the property names (`.money.race.maxi.maxmaxi.colour.hat.namee`) and
the line that writes them (`data.SharedObject.getLocal.data.maxmaxi.namee.flush`).
Decompressed, a save and the code that produced it agree field for field.

Ruffle keeps that object in `localStorage`: its wasm carries
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
player.load('duck-life.swf');   // duck-life-2: 'duck-life-2.swf'
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
sees names it does not recognise. Instrumenting a second movie showed the same
mapper at work on a different name, unchanged:

    127.0.0.1/games/duck-life-2/duck-life-2.swf/mydata      ← what Ruffle composes
    duck-life-2.swf/mydata                                 ← what the document holds

### 14.4 The surface Ruffle uses is the property one

Wrapping the installed area and logging every way into it showed Ruffle reaching
the area as `localStorage[name]` — a property read and a property write — and
never through `getItem`/`setItem`. It wrote the same bytes nine times during one
boot, and six times on a second movie:

    GET[127.0.0.1/games/duck-life-2/duck-life-2.swf/mydata] -> undefined
    SET[127.0.0.1/games/duck-life-2/duck-life-2.swf/mydata] <- 224 chars
    SET[127.0.0.1/games/duck-life-2/duck-life-2.swf/mydata] <- 308 chars   (×5)

Ruffle flushes a SharedObject on a schedule of its own, so `fileWrites` in
`PluStore.stats()` counts a boot, not a save the player made. Note the shape of
that log: one key, reached by property, read before written. A wrapper that logs
`getItem`/`setItem` prints nothing at all and looks like a game that never saves.

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

Duck Life's movie carries MochiAds' preloader stub, which fetches
`http://x.mochiads.com/srv/1/<id>.swf` and pings
`http://mochibot.com/my/core.swf` every time the game is opened. Duck Life 2 has
no Mochi stub but a longer list of the same kind: a CPMStar ad spot
(`server.cpmstar.com`), Bubblebox click-tracking URLs it pings on each screen
change (`…clickreg.php?…&subid=loadscreen`, `splash`, `enternamescreen`,
`menuscreen`), Newgrounds and GameShed hosts, and a GameShed achievement API.
Every one of them lives *inside an SWF*, so there is nothing to delete in a
script file — and none of them ever answered a plain request anyway (a dead host
sends no CORS headers), so refusing them changes nothing the movie does. The page
refuses them in a `window.fetch` guard: same origin, `data:` and `blob:` pass;
anything else is rejected with a warning, once per URL. Ruffle never uses
`XMLHttpRequest` — its wasm contains no such string, and one `fetch_with_request`
— so `window.fetch` is the whole surface. Both converted pages carry the same
guard, with the comment naming what that build reaches for.

### 14.7 Reading the save, and applying one from outside

A SharedObject's bytes are base64'd into an `@file` block, and they are readable
by hand. Decoding both converted saves gives the same shape:

    offset  bytes
    0       `00 bf`
    2       a uint32, big-endian: how many bytes follow the six-byte header
    6       `TCSO`
    10      `00 04 00 00 00 00`
    16      the slot name: a uint16 length, then UTF-8 (`00 06` `mydata`)
    24      four bytes, then the properties
            each = a uint16 name length, the name, then the value:
              number  `00`, eight big-endian bytes (a double), then `00`
              string  `06`, a u29 length, then the UTF-8 bytes

Fitted against both movies, that reads every field and lands exactly on the last
byte; the numbers come back as the values they should be (`maxi` 20, `maxmaxi`
30, `seed` 5) and the names as the strings the constant pool lists. The string
form is the least exercised part of it — both saves hold only empty ones, because
neither duck was ever named — so treat `06` as measured and other variants as
unverified. What matters for hand inspection is that the names are legible, so a
`@file` block can be read with no tooling at all:

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

- every request the page makes is loopback, and the trackers the movie carries
  appear as refusals rather than as outbound requests;
- no exceptions, and no IndexedDB — Ruffle uses none;
- the document holds one block, keyed `<movie>.swf/mydata`;
- the movie renders and responds to input. This is the check that says the player
  works at all: the canvas is not blank, and a click changes the frame;
- the round trip. The cheapest proof is the read itself: wrap the area as it is
  installed ([section 14.9](#149-what-the-second-conversion-added)) and log what
  Ruffle is handed. A fresh document gives `-> undefined`; a document holding the
  save gives that save's length back. Anything the movie then writes it can only
  have got from the document;
- the slower proof, for a save with a value worth watching: write a doctored
  SharedObject from a page that is *not* playing the game, load the game, and
  confirm both that Ruffle is handed exactly those bytes and that the game's own
  variables keep them.

Six further Ruffle wrappers are in this repo still on the old bridge
(`learn-to-fly`, `learn-to-fly-2`, `learn-to-fly-3`, `motox3m-3`,
`the-binding-of-isaac`, `the-worlds-hardest-game`). Each needs the same three
things: the player vendored, `installSharedObjects('<movie>.swf')` before it, and
the movie named correctly.

### 14.9 What the second conversion added

**A movie may not touch its save until the game is started.** Duck Life 1 calls
`getLocal` the moment it loads. Duck Life 2 does not: with the page sitting on its
menu, the area is never touched, there is no read and no write, and the document
stays empty — which looks exactly like a conversion that failed. The first
storage event arrives when the player clicks **PLAY**, and the save follows ~6 s
and ~15 s later (224 bytes, then the full 308 as the game fills in the rest of its
fields). The click is at the bottom centre of the stage — for Duck Life 2's layout,
`(660, 580)` in a 1280×800 window. Nothing about this is Duck Life 2's fault; it
is the normal behaviour of a build that creates its save when a game starts, and
it means *a conversion cannot be judged before the game is played*.

**The read is the round trip.** Instrumenting the installed area
([section 14.4](#144-the-surface-ruffle-uses-is-the-property-one)) gives the
sharpest proof available, and it needs no byte surgery: log every access to the
area, boot once with an empty document, then boot again with the save in place.
The same single key comes back `undefined` the first time and as the stored
body's length the second — and on that second boot the movie writes the *whole*
save from its first flush (308 bytes, six times) where the first boot had to build
up to it (224 four times, then 308). A game that had not read anything would have
rebuilt the partial version again.

To install that wrapper the value has to be caught *as it is installed*, not
where it is returned:

```js
var dp = Object.defineProperty;
Object.defineProperty = function (target, prop, desc) {
  if (target === window && prop === 'localStorage' && desc && 'value' in desc) {
    desc = Object.assign({}, desc, { value: wrapForLogging(desc.value) });
  }
  return dp.call(Object, target, prop, desc);
};
```

Hooking `PluStore.installSharedObjects` instead does nothing, and is worth knowing
about because it fails quietly: the hook wraps the value the call *returns*, while
the area that lands on `window.localStorage` is the one installed inside it, so
nothing that plays the game ever touches the wrapper. Since the wrapper is a
`Proxy` around the real area, PluStore's own `window.localStorage !== area` check
fails while it is in place and prints *"the save would not be ours"*. That warning
is the probe's, not the page's — remove the wrapper and it goes away. Catching the
`PluStore` global instead *does* work, and is the technique
[section 14.10](#1410-what-the-third-conversion-added) uses.

### 14.10 What the third conversion added

**A build can gate its own start behind a dead ad network and still start.** Duck
Life 3 is that build, and it is worth spelling out because it looks like the
conversion failed. It carries the whole MochiAds preloader inside the movie and
traces `MochiServices Connecting...` and `Waiting for MochiAds services to
connect...` on every boot; it loads
`server.cpmstar.com/adviewas2.swf?contentspotid=4553QE607156B` into a clip named
`adBox` after `System.security.allowDomain('server.cpmstar.com')` so the ad can
script the game; and it also carries `x.mochiads.com/srv/1/`, `MochiLC.swf`, a
`link.mochiads.com/linkping.swf` ping, a Kongregate referral and a
`kongregate.stats.submit`. None of those hosts answers today. Measured both ways:
with the abandoned ad client served locally from the Wayback Machine's 2014 copy
of `services.swf`, the handshake *does* complete — the movie logs
`[SERVICES_API] connected!` and `REGISTER GAME …`, and the client writes its own
`services.mochiads.com` SharedObject — and the game then sits in exactly the same
place; with everything off-machine refused it is unaffected and the save arrives
all the same. So there is no ad shim in this repo: the guard stays a plain
refusal. (The client is a real thing to run if a build genuinely needs it: it
reads `listenLC` back off **its own URL**, so serving it without the query string
that the game asks for gives a client that loads, runs and never connects — it
wrote its state and paged in none of its modules. Handing a stand-in to
`loadMovie` also needs a real URL, not a synthesized response: Ruffle derives a
loaded movie's base from where it was fetched, and without one every relative load
inside it fails with *relative URL without a base*.)

**The opening screens have to be clicked through, and the clicking needs a noise
floor.** A fresh boot renders, animates and never touches storage for minutes: no
read, no write, an empty document. The screen animates by itself — about 7.5% of
the frame's pixels differ between two untouched frames 1.5 s apart — so a click
test with a fixed threshold calls every click a hit and none of them
meaningful. Compare each click against the *local* idle noise taken just before
it (a hit is a change of more than 2.5× that); in a 1280×800 window the points
that answered were `(722,559)`, `(1083,559)`, `(632,628)`, `(993,628)`, `(900,590)`,
`(400,590)` and `(540,540)`, and the save appears after roughly six of them. That
is the same lesson as [section 14.9](#149-what-the-second-conversion-added) - a
conversion cannot be judged before the game is played - with teeth on it: here
nothing looked broken, the movie was simply waiting for a click.

**The save is the same slot name as its two siblings**, `mydata`, with a wider
field list, read straight off the movie's own constant pools next to its
`SharedObject.getLocal("mydata") … flush()` calls (of which there are some 170):
`stalvl clilvl runlvl flylvl swilvl money race maxi maxmaxi namee dt strf sthf
athf flyf swif a1 … a10`. The conversion itself is the usual three lines, with
`PluStore.installSharedObjects('duck-life-3.swf')` so the key does not move with
the host.

**The proof, in the area's own log.** A fresh boot gives

    GET[127.0.0.1/games/duck-life-3/duck-life-3.swf/mydata] -> undefined
    SET[127.0.0.1/games/duck-life-3/duck-life-3.swf/mydata] <- 56 chars

The movie asks a second time on a later boot with the same profile, and is handed
the stored body:

    GET[127.0.0.1/games/duck-life-3/duck-life-3.swf/mydata] -> 56 chars

The document it came out of holds exactly one block, `duck-life-3.swf/mydata`, and
its bytes survive a reload unchanged. Note the key in the log is Ruffle's own —
`<host>/games/duck-life-3/<movie>.swf/mydata` — because that is the name the
player asks for; the mapper is what turns it into `duck-life-3.swf/mydata` on the
way in and back again on the way out.

Catching the global is what makes that log possible. The hook has to be in place
*before* the page calls `installSharedObjects`, so it wraps the method on the
global as the global is assigned:

```js
var real = null;
Object.defineProperty(window, 'PluStore', {
  configurable: true,
  get: function () { return real; },
  set: function (v) {
    real = v;
    var orig = v.installSharedObjects.bind(v);
    v.installSharedObjects = function (movie) {
      var area = orig(movie);              // the identity check already passed
      Object.defineProperty(window, 'localStorage', {
        value: new Proxy(area, handlers),  // in place before Ruffle reads it
        configurable: true, writable: true
      });
      return area;
    };
  }
});
```

as `plustore.js` publishes with `global.PluStore = PluStore`, that assignment goes
through the setter, and the wrapper sees every read and write the movie makes.

---

## 15. Verifying a conversion

Do all five. The first two catch a patch that silently did nothing, which is the
failure mode that looks like success. The engine-specific half of each step is
where the work is: [section 11.5](#115-verifying-a-web-storage-conversion) for a
`localStorage` engine, [section 10.5](#105-verifying-a-godot-conversion) for a
Godot export, [section 12.8](#128-verifying-a-playables-conversion) for a host SDK,
[section 14.8](#148-verifying-a-flash-conversion) for a Flash movie, and the notes
at the end of sections 6–9 for the rest.

1. **The document appears.** `localStorage` holds one key, and it is readable
   text: `localStorage.getItem('plu:text:<game>')`.
2. **The old store is untouched.** With the game open, check the old location.
   For GameMaker that means no key in `localStorage` starts with the runner's
   prefix any more:

   ```js
   Object.keys(localStorage).filter(function (k) {
     return k.indexOf('BaconMayDiebySnoutUp.0.') === 0;
   });   // → []
   ```

   Clear those keys once by hand first, or a boot from before the patch leaves
   them behind and the check passes for the wrong reason.

   For Unity it must be zero records:

   ```js
   indexedDB.open('/idbfs').onsuccess = function (e) {
     var db = e.target.result;
     db.transaction(['FILE_DATA']).objectStore('FILE_DATA').count().onsuccess =
       function (ev) { console.log('old store records:', ev.target.result); };
   };
   ```

3. **A value round-trips.** Play, note a value, reload, and confirm it survived.
   For Unity, `unity.player_session_count` increments once per boot — a clean,
   zero-effort check that the player really read the seeded file rather than
   starting fresh. For GameMaker, clear the save and boot again: a game whose
   defaults are deterministic reproduces them byte-for-byte, which is what
   `bacon-may-die` does across all seven files.
4. **A hand-edited value reaches the game.** Change a stored value, reload, and
   confirm the game read it. Re-installs and re-defaults mean the seed did not
   parse. Change it with the player stopped or its flush pinned
   ([section 6.5](#65-applying-an-imported-save)) — a live player writes its own
   tree back over your edit on the next tick, and then the test proves nothing.
5. **No errors.** `PluStore.stats().lastError` is `null` after a boot and a save.

When the old store is IndexedDB [section 8.3](#83-make-the-engine-local-first-and-check-it)
has already taught you not to trust a check that only looks at the store: the
patch can be inert while the store sits quietly at its old contents. The
strongest version of checks 2 and 5 is to instrument the page instead of the
store — a temporary copy of the game page, booted with two wrappers installed
before the engine loads:

```html
<script>
  window.__probe = { idbOpens: [], calls: [] };
  var realOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name) {
    window.__probe.idbOpens.push(String(name));
    return realOpen.apply(this, arguments);
  };
</script>
<script src="../../js/plustore.js"></script>
<script>
  PluStore.configure({ game: '<game>' });
  var realInstance = PluStore.stores.instance;
  PluStore.stores.instance = function (name) {
    var real = realInstance.call(PluStore.stores, name);
    var wrapped = {};
    ['getItem', 'setItem', 'removeItem', 'clear', 'keys'].forEach(function (m) {
      wrapped[m] = function (a, b) {
        window.__probe.calls.push({ store: String(name), method: m, key: String(a) });
        return real[m].apply(real, arguments);
      };
    });
    return wrapped;
  };
</script>
```

For Big FLAPPY Tower that reads back as: `idbOpens` empty, and one call at boot
(`c3-localstorage-ldz28jk2uv2f.getItem('FlappySaveGame')`) — which also names
the keys the game really uses, without guessing from its data files. Delete the
probe page when the conversion is confirmed.

You do not have to *play* the game to see it write, either. The runtime exposes
`self.c3_callFunction(name)`, and the export's own function names are sitting in
`data.json` as function-call actions (`[-2,"Save",null,…]`) — so
`self.c3_callFunction('Save')` runs the game's real save routine and pushes its
real payload through the patched store. That is a far better test than flailing
at the canvas, which a headless webview makes unreliable anyway (no window
focus, synthetic pointer events that a menu may ignore). Big Tower Tiny Square 2
wrote its whole `reduxSaveGame` dictionary that way; editing three fields in the
document first then proved the round trip, because the game read the edited
values at boot and wrote them back unchanged.

Two things Big NEON Tower made worth doing on top of that:

- **Run the control.** Clear the store, boot again, and let the game save. If it
  now writes its *defaults* — the language back to `english`, `TotalDeaths: 0`,
  no trace of the key you injected — then the earlier run really did read the
  document, and those values were not leftovers from your own edit. Without this
  step, "my values survived" and "the game never wrote at all" look the same.
- **Do not read a first-run log line as a conversion fault.** Big NEON Tower logs
  `Error parsing JSON: Unexpected end of JSON input` from its own dictionary
  plugin whenever there is no save to load: the game feeds an empty result
  straight into a JSON parse. localforage returns `null` for a missing key and so
  does `PluStore.stores`, so a first-time player saw the same error on the
  original store. It appears only on a fresh save — boot one with a populated
  save and compare before suspecting the patch.

---

## 16. Inspecting a save

There is nothing to install. The save is one plain-text string, and it is read
through the same API that wrote it:

```js
PluStore.get()                      // the whole document
PluStore.list()                     // [{path, kind, keys}] — contents, without the bodies
PluStore.parse(PluStore.get())      // {dirs, files} — the blocks themselves
PluStore.prefs()                    // the first PlayerPrefs block, decoded
PluStore.stores.names()             // the key/value stores the save holds
PluStore.stores.entries('<name>')   // [{key, tag, value}] — one store, decoded
PluStore.files.list()               // [{name, size}] for a flat file host
PluStore.on(function (doc) { ... }) // every write, as it happens
```

Under the default backend that document lives in `localStorage` under
`plu:text:<game>`, so a browser's own devtools read it as well (Application →
Local Storage), and `PluStore.backends.<name>` decides where else it can live
([section 17](#17-backends)).

What a block holds, by engine:

| Engine | Block | The body |
|---|---|---|
| Unity | `@unity-prefs <path>` | decoded PlayerPrefs — name, type, value |
| Unity, Godot, any filesystem | `@text` / `@base64` | one file verbatim, or one that is not UTF-8 as base64 |
| GameMaker | `@file <name>` | one named file, escaped onto a single line |
| Construct 3 and 2 | `@store <name>` | `key`, type tag, value — one escaped line per entry, sorted |
| Web Storage, Playables, Fancade | `@file <name>` | one key of the area, as stored |

Three decodes are worth doing by hand rather than reading raw:

- **A `@base64` body.** Decode it and look at the bytes: a Godot `.tres` or
  `.shell` is readable that way, and a `UnityPrf\0` header says a PlayerPrefs file
  is there. A Fancade `sandbox/db` body is base64 *of a zlib stream*, so it needs
  an inflate before it is JSON ([section 13.6](#136-what-the-player-then-does)).
- **A `@store` entry.** The tag is the type, so a value that reads back as `"128"`
  when the game stored `128` is a different save, not a formatting choice
  ([section 8.7](#87-store-values-carry-a-type-tag)).
- **A `@unity-prefs` block.** `PluStore.prefs()` decodes it, and the seven header
  bytes are carried through untouched ([section 18](#18-reference)).

The document only changes through `set()` ([section 2](#2-the-contract)), so an
edit made by hand is inert until the page reloads — and for an engine whose flush
runs on the way out, a live game can write its own tree back over the edit first
([section 6.5](#65-applying-an-imported-save)). Stop the game, or pin its flush,
before editing anything into a running page.

---

## 17. Backends

The document is a string, and where it lives is a separate decision. A backend
is any object with three methods:

```js
PluStore.backend = {
  read:  function () { /* → string | null */ },
  write: function (text) { /* persist */ },
  clear: function () { /* remove */ }
};
```

Two ship with the engine: `PluStore.backends.localStorage(key)` (the default —
one key, plain text) and `PluStore.backends.memory()` (nothing persisted; useful
for tests and for a save that should die with the tab). Point it at a file, a
host API, or a remote endpoint by writing your own — nothing else in the engine
needs to change.

---

## 18. Reference

### API

| Call | Does |
|---|---|
| `configure({game, key, mount, filePrefix, backend})` | set up before the game loads |
| `installSharedObjects(movie)` | the Web Storage area, with Ruffle's host-shaped SharedObject keys narrowed to `"<movie>/<name>"` |
| `get()` | the whole save as a string |
| `set(doc)` | validate, store, and broadcast a document |
| `list()` | `[{path, kind, keys}]` for every file in the save |
| `files.read(name)` / `files.write(name, text)` | one named file, for a flat file host |
| `files.exists(name)` / `files.has(name)` | non-empty? / present at all? |
| `files.ensure(name, text)` | write a default only if absent |
| `files.remove(name)` | delete it |
| `files.list()` / `files.names()` | `[{name, size}]` / sorted names |
| `stores.instance(name)` | a localforage-shaped store: `getItem` / `setItem` / `removeItem` / `clear` / `keys`, all promise-returning |
| `stores.localforage(name)` | the same store with node-style callbacks instead, for an engine written against the localforage global |
| `stores.names()` | names of the stores the document holds, sorted |
| `stores.entries(name)` | `[{key, tag, value}]`, decoded |
| `installWebStorage()` | replace the page's `localStorage` with an area over the document (method *and* property access), or `null` if the browser refused |
| `webStorage()` | the same area without installing it |
| `prefs()` | the first PlayerPrefs block, decoded |
| `getValue(name)` / `setValue(name, value, type)` | read/write one PlayerPrefs entry |
| `clear()` | drop the save |
| `on(cb)` / `off(cb)` | subscribe to changes |
| `stats()` | `{game, key, mount, booted, flushed, fileWrites, storeWrites, savedAt, lastError}` |
| `boot(FS, mount)` / `flush(FS, mount)` | the Unity and Godot hooks, called from the patched player |

### PlayerPrefs binary layout

Relevant only when reading a capture by hand:

```
"UnityPrf\0"        9 bytes
header              7 bytes, preserved verbatim (00 01 00 00 00 10 00)
then repeated:
  uint8  nameLength
  bytes  name, UTF-8
  uint8  type         0xFE = int32 little-endian follows
                      0xFD = float32 little-endian follows
                      otherwise the byte is the byte length of a string
  bytes  value
```

The value byte is a type tag, and 0xFE and 0xFD are reserved for it — so a
string value has to stay under 0xFD (252 bytes) or it cannot be told apart from
a float. The encoder enforces that and says so rather than writing an ambiguous
file. A build that writes floats is not exotic: 10 Minutes Till Dawn stores its
`MusicVolume` and `SFXVolume` settings as floats, which is why the codec has to
handle both tags. A build that only ever wrote ints (Snow Rider 3D, Unity 2018)
decodes identically with or without float support.

`PluStore.encodePrefs(PluStore.decodePrefs(bytes))` returns the original bytes
unchanged, header included. The seven header bytes are carried through rather
than interpreted — their meaning is internal to the player, and preserving them
is what makes a re-encode safe to hand back.

---

## 19. Known limits

- **A Flash save is named by the player, host and all.** Ruffle keys a
  SharedObject `<domain><path>/<movie>.swf/<name>`, so the address the page was
  opened from would be part of the save's name and `localhost` and `127.0.0.1`
  would be two saves ([section 14.3](#143-the-key-ruffle-composes-and-why-the-movie-is-named)).
  `installSharedObjects(movie)` narrows it, and the movie argument is not
  optional bookkeeping: leave it out and the save follows the hostname again.
- **A Flash save is written on the player's schedule.** Ruffle flushes a
  SharedObject on its own tick and once more as the page goes away, so
  `fileWrites` counts a boot rather than a save, and a hand edit made while the
  game is running can be overwritten by that dying flush before anything reads
  it.
- **A Flash conversion needs both Ruffle core pairs, and a movie that is named.**
  The player picks its wasm by probing for WebAssembly extensions, so the pair a
  current browser does not use still has to ship, and `player.load()` has to be
  given a real movie rather than the placeholder a wrapper may carry.

- **Fancade writes its mount back when its page goes away.** The player flushes the
  whole of `/sandbox` on unload, so clearing or replacing the document while an old
  player is still alive lets its dying flush put the old save straight back — park
  the frame on `about:blank` first, wait, then write and restart
  ([section 13.7](#137-applying-a-save-from-outside)). A Unity or Godot game has the
  same hazard, since its flush runs on the way out too.
- **A Fancade save is a key space, not a file.** The player loads its database by
  enumerating `localStorage` and asking for every path it finds, so the area has to
  keep the player's own key names
  ([section 13.1](#131-the-engines-own-storage-in-two-layers)). The mounted copy the
  same document produces is incidental, and where it lands depends on how the host
  spells its keys ([section 13.4](#134-a-block-and-its-file-can-be-one-file)).
- **A stripped storage prefix can hide the whole save.** `filePrefix` renames every
  key the area stores, and that is safe only for an engine that hands PluStore
  fully-composed names and never lists them back. An engine that enumerates — as
  this one does, gating on its own prefix — then sees a key space with nothing it
  recognises: it boots empty and reports a save it cannot load, while the document,
  the stats and every direct read look perfect.
- **A Fancade save is a compressed blob.** `sandbox/db` is zlib-compressed JSON as base64,
  with two sibling backups the player maintains itself. Reading it means inflating it;
  editing it means editing a stream, not fields.
- **Two globals this build calls are defined nowhere in it.** The player's command table
  reaches for `adInterstitialLoad()` and `adRewardedLoad()`, neither of which exists in any
  file of the build — upstream's own dangling references, present before the conversion.
  Play did not reach either call; if a later build does, it throws inside the player.
- **The page's last 404 is the browser's own.** The published build linked
  `webapp/favicon.ico`, which its own host answers 404, so the link is gone rather than
  aimed at nothing, and the browser probes `/favicon.ico` instead: one 404 per load, from
  the browser, for a page that declares no icon.
- **Whole-document writes.** Every save rewrites the entire document. Fine for
  the few kilobytes a PlayerPrefs file holds; a game with a multi-megabyte save
  wants chunking first.
- **`flush()` re-reads everything.** It walks the mount and decodes every file
  on each sync tick — roughly 130 times per boot for Snow Rider 3D. It is free
  at 222 bytes of prefs, but a large save should compare size and mtime before
  decoding.
- **The patched framework file no longer matches upstream.** In Snow Rider 3D,
  `Build/SnowRider3D-gd-1.wasm.framework.unityweb.js` went from 514248 to 513912
  bytes. Re-downloading it from the CDN silently undoes the conversion.
- **Unity's loader still creates two empty databases.** `UnityLoader.js` opens a
  `/idbfs-test` capability probe and a `UnityCache` for its download cache. No
  game data goes near either, but they are IndexedDB activity if the goal is
  zero IndexedDB.
- **Nothing is migrated.** A game converted from the old bridge starts from a
  clean save unless you import it by hand.
- **Godot saves when it feels like it.** The engine calls for a sync when it
  closes or renames a file, so a clean install writes nothing until the game
  saves something of its own — and a game whose only `user://` traffic is the
  log may flush nothing on a first run at all. An empty document right after
  boot is expected, not a dead patch.
- **A Unity save is never empty after one boot.** The analytics SDK writes into
  the mount before the game saves anything of its own
  ([section 6.6](#66-the-asmjs-era-layout)), so "the document exists" is not
  evidence that anything was migrated, and "the save has files in it" does not
  mean the game has progress.
- **A Godot save is often binary.** `ConfigFile` is text, but resource and
  settings files are not, and they arrive as `@base64` blocks. That keeps the
  document text and lossless, but it is not editable by hand the way a prefs
  row is.
- **A hosted file map rewrites the document per file.** Every
  `PluStore.files.write` re-serialises the whole save. At the few kilobytes these
  games keep that is free; a game with a large save wants batching.
- **GameMaker cannot list its own files.** HTML5 stubs `file_find_first` and the
  `directory_*` functions out, so no game code can enumerate the save through
  `PluStore.files.list()`. That is a view from outside the engine, not one the game
  can reach.
- **The runner patch is per-build.** The four bodies [section 7.2](#72-the-four-functions-that-are-the-whole-file-layer)
  replaces are minified and can change between GameMaker versions. They are
  small and greppable, but a re-export means re-checking them, the same way a
  re-downloaded Unity framework file silently undoes a Unity conversion.
- **A remote engine script makes the patch inert.** If a Construct export still
  lists a CDN copy in `engineScripts` ([section 8.3](#83-make-the-engine-local-first-and-check-it)),
  the game boots the remote runtime and nothing in this document happens. It is
  the one failure that looks exactly like success, so check it first.
- **A preview export's assets can live on someone else's host.** Big Tower Tiny
  Square 2 does ([section 8.2](#82-check-whether-the-assets-are-local-at-all)).
  Everything now resolves inside the game folder, but the copy is only as
  complete as that host was: 3 of its 10 music tracks came back at a quarter of
  their size and 7 were missing outright, so the local build has less music than
  the CDN version would have had if the files still existed.
- **A referenced file that was never published stays missing.**
  `creditslanguage.json` is fetched by AJAX at boot in both Big Tower games and
  404s everywhere, the CDN copy included; the runtime logs one caught JSON error
  and carries on. Not a conversion artefact, and not worth chasing.
- **Stores with no entries vanish.** `clear()` on a store removes its block, and
  a store whose entries were all removed leaves no trace in the document. What
  is left is the truth about the save, but it does mean the document cannot
  distinguish "never used" from "emptied".
- **localforage methods the runtime never uses are absent.** `length`, `key`,
  `iterate`, `setDriver`, `config`, `driver` and `dropInstance` throw
  "not implemented" in the shipped runtime already, so the adapter does not
  provide them either.
- **The Web Storage area's property surface needs `Proxy`.** The area installed
  by `installWebStorage()` answers both ways — the six methods and
  `localStorage[key]`, including `in`, `delete` and `Object.keys`
  ([section 11.6](#116-the-second-surface-localstoragekey)) — but the property
  half is a `Proxy`, so a browser without one gets the method surface only. Every
  browser that runs these games has it; the fallback exists so that an old one
  degrades to an empty save rather than to a thrown exception.
- **A key named the same as a method is shadowed.** `localStorage.getItem = 1`
  sets nothing on the real area either, so a game cannot store a key called
  `getItem`, `length` or `clear` through property access; `setItem('getItem', …)`
  still works. No game here does it.
- **An engine's own endpoint cannot be removed, only refused.** Crazy Cattle 3D's
  high-score URL lives in `index.wasm`, so the page blocks the host rather than
  the code ([section 10.8](#108-an-endpoint-inside-the-engine)). The request is
  gone from the network log; the engine still spends its timeout and still prints
  "Update fail!" for a host it can no longer reach.
- **Cookie Clicker still carries its cookie store in the source.**
  `WriteSave`'s "legacy system" branch assigns `document.cookie`, live in the file
  and unreachable in this build (`Game.useLocalStorage = 1`, never reassigned).
  Both of its readers are gone, so nothing can load from it, but a reader will
  find the code and should know why it is there.
- **A host SDK cannot be loaded off the host.** Playables' `IN_PLAYABLES_ENV` is
  `window !== window.parent`, so the real SDK either drops every save (top-level)
  or hangs on a parent that never answers (framed), and either way it nulls
  `localStorage` on the way past ([section 12.1](#121-what-the-sdk-does-when-there-is-no-host)).
  The local stand-in is the only workable option, which also means the SDK's
  surface has to be extended by hand when a game reaches for a member it does not
  define yet.
- **A store a game writes but never reads is a converted-looking store.**
  Crossy Road shipped with its own bulk load commented out of the startup chain
  ([section 12.3](#123-the-trap-the-games-own-load-path-may-be-dead-code)), so it
  wrote its defaults over the save on every boot while the document looked
  healthy. Check that a value survives a reload, not that a document exists.
- **A host-SDK save only moves on the game's own events.** Crossy Road's blob is
  rewritten on a new high score, a flag, a gumball prize, a coin change and a
  sound toggle — nothing else. An edited field can therefore sit in the document
  out of step with the frame's memory until one of those happens, which is
  information, not drift: the stored value and the frame's value are two different
  things until the game writes again.
- **A Playables game's leaderboard goes nowhere.** `engagement.sendScore()` is
  answered locally and says so once in the console. The score is kept in the save;
  the board is the host's and there is no host.
- **`@file test` in a Web Storage game is not a save.** It is the game's own
  capability probe (`localStorage.setItem('test', 0)`), stored like any other
  write. Harmless, and worth not deleting: it is how you know the area swap took.

---

*Pluto GCDN — 9/16/2026*
