animationDelay = 100;
minSearchTime = 100;

// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function() {
  var manager = new GameManager(8, KeyboardInputManager, HTMLActuator);
});