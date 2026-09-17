/*
 * ytgame-local — a local stand-in for the YouTube Playables SDK.
 *
 * Crossy Road does not save through localStorage. Its save is the SDK's game
 * data: `saveGameData()` calls `ytgame.game.saveData(JSON.stringify({ ... 13
 * fields ... }))`, and ~18 load points call `getYTCloudItem(key, default)`,
 * which parses that same blob. The SDK's game-data slot *is* this game's save
 * file, so neither of the two obvious moves works:
 *
 *   * Load the real SDK. `IN_PLAYABLES_ENV` is just `window !== window.parent`.
 *     Top-level, the SDK decides it is not in Playables, and then `loadData()`
 *     resolves "" and `saveData()` does nothing — every save is silently
 *     dropped, which is how a game streams localStorage writes into the void.
 *     Framed, it decides the opposite and waits on a host that is not there.
 *     It also redefines `window.localStorage` as null when it thinks it is
 *     embedded, to force games onto its own API, so it can break the very
 *     fallback a game keeps for the not-embedded case.
 *   * Define no `ytgame` at all. `saveGameData()` calls `ytgame.game.saveData`
 *     with no guard, so the first save throws.
 *
 * This file is the third option: the same object shape, backed by the document.
 * `IN_PLAYABLES_ENV` is true so the game takes its own cloud path — the path
 * its 13-field save is written for — and that path now ends in PluStore rather
 * than in a postMessage nobody answers. The game's ~39 local `crossyStorage`
 * calls all sit in the `else` branches of those same conditionals, so this is
 * also what keeps the two halves from disagreeing about which store is real:
 * there is only ever one, and it is the one below.
 *
 * Only the members this build touches are defined — `game.loadData`,
 * `game.saveData`, `game.gameReady`, `game.firstFrameReady`,
 * `system.isAudioEnabled`, `system.onAudioEnabledChange`,
 * `engagement.sendScore`. A Playables game that reaches for more should extend
 * this list rather than load the SDK, for the reasons above.
 *
 * The save is one block in the document, named after the SDK's own wording for
 * it: `ytgameGameData`.
 */
(function () {
  'use strict';

  var KEY = 'ytgameGameData';

  /* installWebStorage() swaps window.localStorage as well, which is a bonus
     rather than the point: the area held here is the save either way. It
     returns null only when the browser refused the swap — worth knowing about,
     not a reason to leave the game without a store. */
  var area = PluStore.installWebStorage() || PluStore.webStorage();

  function read() {
    return area.getItem(KEY) || '';
  }

  function write(text) {
    area.setItem(KEY, text);
  }

  var saidScoresAreLocal = false;

  window.ytgame = {
    SDK_VERSION: '1.20250303.0000',

    /* True on purpose: see the header. The game's modern path runs, its legacy
       localStorage path does not. */
    IN_PLAYABLES_ENV: true,

    game: {
      /* The whole save, as the game serialised it. Absent reads "" — what the
         real SDK answers when there is nothing stored, and what the game's own
         `if (data)` treats as "no save yet". */
      loadData: function () {
        return Promise.resolve(read());
      },

      /* The game passes a complete object, so this replaces rather than merges.
         It is not size-capped: the SDK refuses a payload over 3 MiB because it
         has to ship it over postMessage, and a local document has no such
         limit. Capping it here would refuse saves the host would have kept. */
      saveData: function (text) {
        write(text);
        return Promise.resolve();
      },

      gameReady: function () {
        return Promise.resolve();
      },

      firstFrameReady: function () {
        return Promise.resolve();
      }
    },

    system: {
      /* Synchronous in the SDK, and a boolean: the game assigns the result
         straight into `isYouTubeAudioEnabled`. A Promise would be truthy for
         the wrong reason. */
      isAudioEnabled: function () {
        return true;
      },

      /* Registering a listener returns an unsubscribe function. The host is the
         one that would ever fire it, and there is no host. */
      onAudioEnabledChange: function () {
        return function () {};
      }
    },

    engagement: {
      /* Scores have nowhere to go: the leaderboard is YouTube's. The game calls
         this with `.then()`/`.catch()` on every game over, so it has to be a
         promise, and refusing would only fire the game's error path. Said once,
         so the console does not fill up with it. */
      sendScore: function () {
        if (!saidScoresAreLocal) {
          saidScoresAreLocal = true;
          console.info('Crossy Road: running locally — scores stay on this machine, ' +
            'they are not submitted anywhere.');
        }
        return Promise.resolve();
      }
    }
  };
})();
