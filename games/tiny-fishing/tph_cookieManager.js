/* The game's real save. Tiny Fishing keeps its progress - money, gems, every
   upgrade and every fish stat, about a hundred fields - in cookies, through
   this extension's three functions, not in the GameMaker file layer. So a
   conversion that only routes file_* leaves the actual save in the browser.

   A cookie jar is a flat map of name to string whose expiry the game sets once
   (100 days) and never asks about again, which is exactly what PluStore's Web
   Storage area is: @file blocks in the same text document, keyed by the name
   the game itself uses (STORAGE.md section 7.6). The three function shapes are
   unchanged, because the GML calls them by name and reads 1/0/null back.

   What is deliberately *not* here: document.cookie. Nothing in this build
   should be able to write the browser's own jar, and after this patch nothing
   does - a boot leaves document.cookie empty. */

var version = "1.0";

function cookieArea() {
  return (typeof PluStore !== 'undefined' && PluStore.webStorage) ? PluStore.webStorage() : null;
}

function cookieSet(argument0, argument1, argument2) {
  try {
    var area = cookieArea();
    if (!area) return 0;
    /* A non-positive lifetime is a deletion, which is what a browser does with
       an expiry that has already passed. Everything else is a write; the expiry
       itself is not recorded because the session cookie a browser would have
       dropped at close is not how this game reads its save back. */
    if (typeof argument2 === 'number' && argument2 <= 0) {
      area.removeItem(argument0);
      return 1;
    }
    area.setItem(argument0, escape(argument1));
    return 1;
  } catch (e) {
    return e;
  }
}

function cookieGet(argument0) {
  try {
    var area = cookieArea();
    if (!area) return null;
    var value = area.getItem(argument0);
    if (value === null || value === undefined) return null;
    return unescape(value);
  } catch (e) {
    return e;
  }
}

function cookieExsists(argument0) {
  try {
    var area = cookieArea();
    if (!area) return 0;
    var value = area.getItem(argument0);
    if (value === null || value === undefined || value === "") return 0;
    return 1;
  } catch (e) {
    return e;
  }
}
