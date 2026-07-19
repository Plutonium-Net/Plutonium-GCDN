(function () {
  'use strict';
  function snapshot() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    return out;
  }
  function sendSnapshot() {
    try {
      window.parent.postMessage(
        { plu: true, type: 'plu_sync_data', saves: snapshot() },
        '*'
      );
    } catch (_) {}
  }
  let _debounce = null;
  function scheduleSnapshot() {
    clearTimeout(_debounce);
    _debounce = setTimeout(sendSnapshot, 800);
  }
  const _origSetItem    = localStorage.setItem.bind(localStorage);
  const _origRemoveItem = localStorage.removeItem.bind(localStorage);
  const _origClear      = localStorage.clear.bind(localStorage);

  try {
    Object.defineProperty(window, 'localStorage', {
      value: new Proxy(localStorage, {
        get(target, prop) {
          if (prop === 'setItem') {
            return function (key, value) {
              _origSetItem(key, value);
              scheduleSnapshot();
            };
          }
          if (prop === 'removeItem') {
            return function (key) {
              _origRemoveItem(key);
              scheduleSnapshot();
            };
          }
          if (prop === 'clear') {
            return function () {
              _origClear();
              scheduleSnapshot();
            };
          }
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        },
      }),
      writable: false,
      configurable: false,
    });
  } catch (_) {
  }
  window.addEventListener('message', function (e) {
    if (!e.data?.plu) return;

    if (e.data.type === 'plu_sync_request') {
      sendSnapshot();
    }

    if (e.data.type === 'plu_sync_restore') {
      const saves = e.data.saves || {};
      try {
        Object.entries(saves).forEach(([k, v]) => _origSetItem(k, v));
      } catch (_) {}
    }
  });

})();
