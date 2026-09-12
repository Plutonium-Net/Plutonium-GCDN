/// Poki portal integration removed - this build is self-hosted.
///
/// The Poki SDK existed only for the poki.com portal: loading-progress
/// reporting, commercial/rewarded ad breaks, gameplay telemetry and
/// happyTime. With ads disabled and no portal, none of it affects gameplay.
///
/// The function names below are deliberately kept, because the GameMaker
/// runner calls them by name (poki_break, poki_gameplay_start, etc.).
/// Their bodies no longer touch any external service.

var adStarted = false;
var gameplayStarted = false;

function poki_loading_finished() {
	poki_log("Loading finished");
}

function poki_loading_update(percents) {
	poki_log("Loading update: " + percents);
}

function poki_gameplay_start(reason) {
    if (!gameplayStarted) {
        poki_log("Gameplay Start: " + reason);
        gameplayStarted = true;
    }
}

function poki_adblock_send() {
    poki_callback("poki.adblock", adsAreDisabled);
}

function poki_gameplay_stop(reason) {
    if (gameplayStarted) {
	    poki_log("Gameplay Stop: " + reason);
        gameplayStarted = false;
    }
}

function poki_happy(value) {
	// reward feedback hook - nothing to report to without a portal
}

function poki_break(tag) {
    if (!adStarted) {
        poki_callback("poki.break.started", tag);
        // No ad to show, so complete the break immediately, which is what the
        // Poki SDK's own offline shim did (it auto-resolved commercialBreak).
        poki_callback("poki.break.completed", tag);
        setTimeout(poki_ad_reset, 1000);
        adStarted = true;
    }
}

function poki_ad_reset() {
    adStarted = false;
}

function poki_rewarded_break(tag) {
	poki_callback("poki.rewarded.started", tag);
	// Reported as failed, matching the Poki SDK's offline shim, which always
	// resolved rewardedBreak(false) when no ad was served.
	poki_callback("poki.rewarded.failed", tag);
}

function poki_block_check() {
    // Was a Poki sitelock that rewrote window.location.href to poki.com when
    // the page was not hosted on poki.com. Its body was already commented out
    // in the original file; the payload is gone so it cannot be revived.
}

var gameReady = false;

function game_ready(resize) {
	gameReady = true;
}

function poki_callback(event, args) {
	gmCallback.game_callback(event, args);
}
