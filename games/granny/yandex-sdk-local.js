/*
 * yandex-sdk-local — a local stand-in for the Yandex Games SDK.
 *
 * Granny was shipped for Yandex Games, and its build reaches for the SDK from
 * inside the compiled glue rather than through page functions. Three imports,
 * all of them ads:
 *
 *   function _Yandex_GetDeviceType() {
 *     YaGames.init().then(ysdk => {
 *       myGameInstance.SendMessage("YandexAdManager", "MY_SetDeviceType", ysdk.deviceInfo.type)
 *     })
 *   }
 *
 *   function _Yandex_ShowInterstitial() {
 *     YaGames.init().then(ysdk => ysdk.adv.showFullscreenAdv({
 *       callbacks: {
 *         onOpen: () => { myGameInstance.SendMessage("YandexAdManager", "MY_AdOpenedSuccess") },
 *         onClose: function(wasShown) {}, onError: function(error) {}
 *       }
 *     }))
 *   }
 *
 *   function _Yandex_ShowRewarded(value) {
 *     YaGames.init().then(ysdk => ysdk.adv.showRewardedVideo({
 *       callbacks: {
 *         onOpen: () => { myGameInstance.SendMessage("YandexAdManager", "MY_AdOpenedSuccess") },
 *         onRewarded: () => { myGameInstance.SendMessage("YandexAdManager", "MY_GetAward", value) },
 *         onClose: () => {}, onError: e => {}
 *       }
 *     }))
 *   }
 *
 * The wrapper page supplied those `YaGames` from a fourth-party script
 * (`sdk.js` off jsDelivr), which is the Yandex SDK — 153 KB of it, Metrica
 * counter and handshake included — so the ads path in a local copy is the same
 * story as any other host SDK: the SDK is not loaded, and this file answers the
 * three imports instead.
 *
 * **This build has no SDK save plane.** That is worth stating plainly because
 * the previous conversion did: Funny Shooter 2 stored progress through
 * `player.getData`/`player.setData` as well as through `/idbfs`, and nothing in
 * Granny's glue calls `getPlayer`, `getData` or `setData` on the SDK at all —
 * the only `getData`/`setData` in the file are the Web Audio and lazy-array
 * ones. Granny's save is `PlayerPrefs` in `/idbfs`, which the patched glue
 * hands to PluStore ([section 6.3](../STORAGE.md#63-cut-the-indexeddb-persistence)).
 *
 * So: ads declined, device reported from the browser, and nothing stored here.
 */
(function () {
  'use strict';

  var saidAds = false;

  function noAdService() {
    if (!saidAds) {
      saidAds = true;
      console.info('Granny: running locally — there is no ad service here, so ' +
        'interstitials are skipped and rewarded ads are declined.');
    }
  }

  /* The SDK's own vocabulary: desktop, mobile, tablet, tv. Nothing here is a
     television, and the browser is the best evidence available for the rest —
     the same evidence the SDK uses when it has no host to ask. */
  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/iPhone|iPod|Android|Mobile|Windows Phone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function makeAdv() {
    return {
      /* Declined, but answered. The game waits on these callbacks: `onOpen`
         sends `MY_AdOpenedSuccess`, which is the "the ad session is over, carry
         on" signal, so dropping the callback is a game that stops responding to
         its own ad request. `onRewarded` sends `MY_GetAward`, and that one must
         never fire — a reward granted without an ad is free currency. */
      showFullscreenAdv: function (settings) {
        noAdService();
        var callbacks = (settings && settings.callbacks) || {};
        try { if (callbacks.onOpen) callbacks.onOpen(); } catch (e) {}
        try { if (callbacks.onClose) callbacks.onClose(true); } catch (e) {}
        return Promise.resolve();
      },

      showRewardedVideo: function (settings) {
        noAdService();
        var callbacks = (settings && settings.callbacks) || {};
        try { if (callbacks.onOpen) callbacks.onOpen(); } catch (e) {}
        try { if (callbacks.onError) callbacks.onError(new Error('no ad service in a local copy')); } catch (e) {}
        try { if (callbacks.onClose) callbacks.onClose(); } catch (e) {}
        return Promise.resolve();
      },

      /* The page's own banner path is gone with the GameMonetize glue it came
         from (see index.html), but a build that asks for a banner should get an
         answer rather than a thrown TypeError. */
      showBannerAdv: function () { noAdService(); return Promise.resolve({ stickyAdvIsShowing: false }); },
      hideBannerAdv: function () { return Promise.resolve({ stickyAdvIsShowing: false }); },
      getBannerAdvStatus: function () { return Promise.resolve({ stickyAdvIsShowing: false }); }
    };
  }

  /* One object, handed out by every call: the glue calls `YaGames.init()` once
     per ad request, and a stand-in that built a new one each time would be
     inventing state the SDK does not have either. */
  var sdk = {
    environment: {
      i18n: { lang: (navigator.language || 'en').toLowerCase(), tld: 'com' },
      app: { id: '' }
    },
    deviceInfo: { type: deviceType() },
    adv: makeAdv()
  };

  window.YaGames = {
    init: function () { return Promise.resolve(sdk); }
  };
})();
