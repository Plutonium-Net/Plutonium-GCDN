/*
 * poki-local — a local stand-in for the Poki platform SDK.
 *
 * Drive Mad is a Poki build, and it will not start without this: its boot
 * sequence is
 *
 *     PokiSDK.init().then(setPokiInited).catch(setPokiInited)
 *     function setPokiInited() { PokiSDK.gameLoadingStart(); pokiInited = true; }
 *     function tryStartGame() { ... if (!postRunDone || !theDomLoaded || !pokiInited) retry
 *                               gameReadyToStart = true;
 *                               PokiSDK.gameLoadingFinished();
 *                               PokiSDK.commercialBreak().then(() => { startGame() }); }
 *
 * so `init()` must settle, `gameLoadingStart()` is called with no guard at all,
 * and the game only starts once `commercialBreak()` resolves. Ten retries at
 * 100 ms apart across three flags, then it gives up silently — which is what a
 * missing SDK looks like: a loading bar that reaches the end and stops.
 *
 * The published `poki-sdk.js` is a loader, not the SDK: it injects
 * `https://game-cdn.poki.com/scripts/<ver>/poki-sdk-<device>.js` at runtime, so
 * vendoring it would vendor a network call rather than remove one. The game
 * touches seven members and no more — `init`, `gameLoadingStart`,
 * `gameLoadingFinished`, `gameplayStart`, `gameplayStop`, `commercialBreak`,
 * `rewardedBreak` — so this file is those seven, answered locally, which is also
 * what makes the load path of the conversion testable.
 *
 * Ad semantics, deliberately: `commercialBreak()` resolves at once (there is no
 * ad to watch, and refusing to resolve would hold the loading screen forever).
 * `rewardedBreak()` resolves `false` — no ad was watched, so no reward — which
 * is the same answer the real SDK gives when it cannot fill an ad. The game
 * passes that straight to its own `ad_rewarded_on_showed(0)`.
 */
(function () {
  'use strict';

  var saidNoAds = false;

  function note() {
    if (saidNoAds) return;
    saidNoAds = true;
    console.info('Drive Mad: running locally — there is no ad service here, so ' +
      'interstitials are skipped and rewarded ads are declined.');
  }

  window.PokiSDK = {
    /* The host handshake. Resolves immediately: there is no host, and the
       game's own `.catch` would have treated a rejection the same way. */
    init: function () {
      note();
      return Promise.resolve();
    },

    /* All four are void in the real SDK, and none is awaited. */
    gameLoadingStart: function () {},
    gameLoadingFinished: function () {},
    gameplayStart: function () {},
    gameplayStop: function () {},

    /* Not skipped, merely instant — the game starts from this promise. */
    commercialBreak: function () {
      note();
      return Promise.resolve();
    },

    /* Resolves whether a reward was earned. False, because nothing was shown. */
    rewardedBreak: function () {
      note();
      return Promise.resolve(false);
    },

    /* Not called by this build, kept for the shape: the loader calls
       customEvent inside a try/catch, so a game update may reach for it. */
    customEvent: function () {}
  };
})();
