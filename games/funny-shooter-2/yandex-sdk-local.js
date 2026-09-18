/*
 * yandex-sdk-local — a local stand-in for the Yandex Games SDK.
 *
 * Funny Shooter 2 was shipped for Yandex Games, and its C# is written against
 * two storage surfaces at once. The page it ships with calls into the SDK for
 * one of them and the player's own filesystem for the other:
 *
 *   PlayerPrefs        the player's /idbfs, i.e. what the patched glue now
 *                      hands to PluStore.boot / PluStore.flush.
 *   the SDK's player   `player.getData(["save1", "save2", "counterFunny2"])`
 *   data               to load, `player.setData({ save1, save2,
 *                      counterFunny2 })` to store.
 *
 * The C# reaches the page through three imports — `_CheckSave()` (which calls
 * `checkSave()` → `loadData()`), `_SaveCloud(save1, save2, counter)` (which
 * calls `saveCloud(...)`) and `_SyncFiles()` (now a PluStore flush). The second
 * surface is the load-bearing one for a returning player: the cloud pair is
 * what restores a run, and `counterFunny2` is the counter the game compares
 * against to decide whose save is newer.
 *
 * Loading the real SDK — the `v2.js` this page used to pull off jsDelivr — was
 * measured before this file was written, on the same headless Chrome this
 * conversion was verified in, and it fails in a way that is worse than being
 * absent:
 *
 *   * It resolves `YaGames.init()` anyway, from a fantasy environment, because
 *     `window.YandexGamesSDKEnvironment` is simply undefined: `i18n.lang` and
 *     `i18n.tld` both come back "ru" and `app.id` is "". This page reads `tld`
 *     to decide the game's region (anything but "com"/"com.tr" is 0) and `lang`
 *     to pick its language, so a local player would be told they are Russian on
 *     the ru domain.
 *   * Then `getPlayer({ signed: true })` rejects with "No parent to post
 *     message": there is no Yandex Games frame above this page to handshake
 *     with over postMessage. `player` stays null, `loadData()` logs "No Save"
 *     and returns without sending the game anything, and `saveCloud()` returns
 *     without writing anything. Every cloud save is dropped in silence, and the
 *     game looks like a game that does not remember you.
 *   * It also calls home while it does it: the Metrica counter
 *     `https://mc.yandex.ru/watch/49035923` is requested on load, plus whatever
 *     else the SDK decides to report.
 *
 * So the real SDK is not loaded at all. This file is the same object shape the
 * page already talks to, backed by the one document. `player.getData` and
 * `player.setData` are the only members that store anything, and they store it
 * as blocks named after the game's own keys (`yandex/save1`, `yandex/save2`,
 * `yandex/counterFunny2`), which is also what keeps them out of the way of the
 * player's own tree in the same document: PluStore carries hosted blocks across
 * a Unity flush, and a block named exactly `save1` would claim `/idbfs/save1`
 * as its own spelling while being carried.
 *
 * Only the members this build touches are defined. A build that reaches for
 * more of the SDK should extend this file rather than load `v2.js`, for the
 * reasons above.
 */
(function () {
  'use strict';

  var PREFIX = 'yandex/';

  /* The keys the page asks for, in one place: `getData` must answer for exactly
     the keys it was asked about, and `setData` must not invent the others. */
  function keyFor(name) { return PREFIX + name; }

  function read(name) {
    var text = PluStore.files.read(keyFor(name));
    return text === null ? null : text;
  }

  function write(name, value) {
    PluStore.files.write(keyFor(name), value === undefined || value === null ? '' : String(value));
  }

  /* One line per kind of thing that cannot work here, so a session's console
     says what is missing once rather than on every call. */
  var saidAds = false, saidStore = false;

  function noAdService() {
    if (!saidAds) {
      saidAds = true;
      console.info('Funny Shooter 2: running locally — there is no ad service here, ' +
        'so interstitials are skipped and rewarded ads are declined.');
    }
  }

  function noStore() {
    if (!saidStore) {
      saidStore = true;
      console.info('Funny Shooter 2: running locally — the in-game store is Yandex\'s, ' +
        'so nothing can be bought and nothing is owned.');
    }
  }

  function makePlayer() {
    return {
      /* Answers for the keys it was asked about, and only those that exist —
         which is the shape the page already handles: it tests
         `if (data.save1)` and `if (data.counterFunny2)`. */
      getData: function (keys) {
        var out = {};
        var list = keys === undefined ? PluStore.files.names() : keys;
        for (var i = 0; i < list.length; i++) {
          var name = String(list[i]).replace(/^yandex\//, '');
          var text = read(name);
          if (text !== null) out[name] = text;
        }
        return Promise.resolve(out);
      },

      /* The page passes a complete object, so this replaces the keys it names
         and leaves the rest. The SDK's second argument (flush: false) is about
         when *it* ships a buffered write to the server; the document is written
         synchronously here, so there is nothing to defer. */
      setData: function (values, flush) {
        if (values && typeof values === 'object') {
          for (var name in values) {
            if (values.hasOwnProperty(name)) write(name, values[name]);
          }
        }
        return Promise.resolve();
      },

      /* The game is played in a browser tab, so it is not signed in anywhere —
         but a player that is not signed in still gets its own data stored
         locally, which is the case this stands in for. */
      getMode: function () { return 'lite'; },
      isAuthorized: function () { return true; },
      getName: function () { return ''; }
    };
  }

  function makePayments() {
    noStore();
    return {
      /* Nothing is owned and nothing is on offer. Both are empty rather than
         rejected: an empty catalogue is what a store with no products looks
         like, and it keeps the page's `initPurchasing()`/`checkShop()` on their
         normal path instead of their catch. */
      getPurchases: function () { return Promise.resolve([]); },
      getCatalog: function () { return Promise.resolve([]); },
      purchase: function (options) {
        return Promise.reject(new Error('no store in a local copy: cannot buy ' +
          ((options && options.id) || 'anything') ));
      },
      consumePurchase: function () { return Promise.resolve(); }
    };
  }

  function makeSdk(options) {
    var adv = {
      /* Skipped, and the page is told it closed normally: its own `onAdvClose`
         is what the host would have called, and the game waits on
         `AudioEnable(1)`, which the page sends from `onClose`. A callback never
         fired is a game that never plays its sound again. */
      showFullscreenAdv: function (settings) {
        noAdService();
        var callbacks = (settings && settings.callbacks) || {};
        try { if (callbacks.onOpen) callbacks.onOpen(); } catch (e) {}
        try { if (callbacks.onClose) callbacks.onClose(true); } catch (e) {}
        try { if (options && options.adv && options.adv.onAdvClose) options.adv.onAdvClose(true); } catch (e) {}
        return Promise.resolve();
      },

      /* Declined rather than pretended: a rewarded ad that reported success
         would hand out a weapon nobody watched anything for. The page's
         `onError` sends `AudioEnable(1)`, and its `onClose` does the same, so
         the game is left where it started instead of waiting on a reward. */
      showRewardedVideo: function (settings) {
        noAdService();
        var callbacks = (settings && settings.callbacks) || {};
        try { if (callbacks.onOpen) callbacks.onOpen(); } catch (e) {}
        try { if (callbacks.onError) callbacks.onError(new Error('no ad service in a local copy')); } catch (e) {}
        try { if (callbacks.onClose) callbacks.onClose(); } catch (e) {}
        return Promise.resolve();
      },

      showBannerAdv: function () { noAdService(); return Promise.resolve(); },
      hideBannerAdv: function () { return Promise.resolve(); },
      getBannerAdvStatus: function () { return Promise.resolve({ stickyAdvIsShowing: false }); }
    };

    return {
      /* The page reads `tld` to set the game's region flag and `lang` to set
         its language. The host is not Yandex, so the flag is the non-CIS one
         and the language is the browser's own. */
      environment: {
        i18n: { lang: (navigator.language || 'en').toLowerCase(), tld: 'com' },
        app: { id: '' }
      },

      getPlayer: function () { return Promise.resolve(makePlayer()); },
      getPayments: function () { return Promise.resolve(makePayments()); },
      adv: adv,

      /* The page never calls these, and a shortcut API that cannot make a
         shortcut is not worth inventing an answer for. */
      getStorage: function () { return Promise.reject(new Error('no host storage in a local copy')); },
      getLeaderboards: function () { return Promise.reject(new Error('no leaderboards in a local copy')); },
      isAvailableMethod: function () { return Promise.resolve(false); },
      onEvent: function () {}
    };
  }

  window.YaGames = {
    /* The page calls this once, before anything else, and uses the one promise
       it resolves. */
    init: function (options) { return Promise.resolve(makeSdk(options || {})); }
  };
})();
