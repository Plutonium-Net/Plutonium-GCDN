/* Local stand-in for the GameMonetize SDK.
 *
 * The export's page used to load the real one from
 * https://cdn.jsdelivr.net/gh/st39/sdk@main/sdk.js, and the GM_SDK plugin in
 * scripts/c3runtime.js injects that URL itself, so it cannot simply be dropped:
 * the plugin's ShowAd() reads window.sdk and its guard is a substring test
 * ("undefined" !== e) that passes for an undefined object, then throws on the
 * property access. Offline there is no ad network to talk to, so this reports
 * itself ready, accepts the two banner calls as no-ops, and keeps the plugin's
 * state machine in its "not playing an ad" state.
 *
 * Event names and the window.SDK_OPTIONS contract are the real SDK's:
 * the plugin installs { gameId, onEvent } and expects to be told SDK_READY and
 * SDK_GAME_START / SDK_GAME_PAUSE / COMPLETE.
 */
'use strict';
(function () {
  function emit(name) {
    var options = window.SDK_OPTIONS;
    if (!options || typeof options.onEvent !== 'function') return;
    try {
      options.onEvent({ name: name, gameId: options.gameId });
    } catch (e) {
      /* the game's own handler threw; nothing here can help with that */
    }
  }

  window.sdk = {
    showBanner: function () { emit('SDK_GAME_PAUSE'); emit('SDK_GAME_START'); },
    hideBanner: function () {},
    preloadAd: function () { emit('SDK_READY'); },
    showAd: function () { emit('SDK_GAME_PAUSE'); emit('SDK_GAME_START'); },
    gameStart: function () { emit('SDK_GAME_START'); },
    gamePause: function () { emit('SDK_GAME_PAUSE'); }
  };

  /* The plugin sets window.SDK_OPTIONS inside its constructor, which is still
     running when this file is injected, so announce readiness on the next turn
     — and once more shortly after, in case the plugin was created later. */
  setTimeout(function () { emit('SDK_READY'); emit('SDK_GAME_START'); }, 0);
  setTimeout(function () { emit('SDK_READY'); }, 500);
})();
