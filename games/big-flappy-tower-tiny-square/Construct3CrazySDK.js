// CrazySDK implementation for Construct3 beta 1
// This file is to be used for CrazyGames SDK integration for Construct3 games, for usage please refer to the documentation (https://developer.crazygames.com/sdk#Construct3)

const DEBUG = getQueryStringValue('sdk_debug');

debug('Loading SDK');

let crazysdk;
let adPromiseResolve;
let hasAdBlock;

const sdkElem = document.createElement('script');
sdkElem.type = 'text/javascript';
sdkElem.src = './cg-sdk.js';
sdkElem.onload = sdkInit;
document.body.appendChild(sdkElem);

function installListeners() {
  debug('Install listeners');
  crazysdk.addEventListener('bannerRendered', (event) => event.containerId);
  crazysdk.addEventListener('bannerError', (event) => bannerError(event.error));
  crazysdk.addEventListener('adStarted', adStarted);
  crazysdk.addEventListener('adError', adError);
  crazysdk.addEventListener('adFinished', adFinished);
}

function adStarted() {
  debug('Ad started playing');
}

function adError() {
  debug('An error happened when trying to play an ad.');
  resolveAd();
}

function adFinished() {
  debug('The ad finished playing successfully');
  resolveAd();
}

function bannerDisplayed(bannerId) {
  debug(`Banner for container ${bannerId} has been rendered!`);
}

function bannerError(error) {
  debug(`Banner render error: ${error}`);
}

function debug(msg) {
  if (DEBUG) {
    console.log('[CrazySDK-Construct] ' + msg);
  }
}

function getQueryStringValue(key) {
  return decodeURIComponent(
    window.location.search.replace(
      new RegExp('^(?:.*[&\\?]' + encodeURIComponent(key).replace(/[.+*]/g, '\\$&') + '(?:\\=([^&]*))?)?.*$', 'i'),
      '$1',
    ),
  );
}

function resolveAd() {
  if (adPromiseResolve) {
    adPromiseResolve();
    adPromiseResolve = null;
  }
}

function sdkInit() {
  debug('Initializing');
  crazysdk = window.CrazyGames.CrazySDK.getInstance(); //Getting the SDK
  crazysdk.init();
  installListeners();

  crazysdk.getInviteParameter = (paramName) => {
    return getQueryStringValue(paramName);
  };

  crazysdk.displayBanners = (banners) => {
    if (!banners || !Array.isArray(banners)) {
      debug('displayBanners function is taking an array of banners description as parameter.');
      return;
    }
    const request = [];
    for (const banner of banners) {
      if (banner.x === undefined || banner.y === undefined || !banner.width || !banner.height || !banner.id) {
        debug('Some properties are missing in your banner description, a banner is defined by: "x", "y", "width", "height" and "id"');
        return;
      }

      const container = document.createElement('div');
      container.style.cssText = `
        position: absolute;
        top: ${banner.y}px;
        left: ${banner.x}px;
        width: ${banner.width}px;
        height: ${banner.height}px;
    `;
      container.id = banner.id;
      document.body.appendChild(container);
      request.push({
        containerId: banner.id,
        size: `${banner.width}x${banner.height}`,
      });
    }
    if (request.length > 0) {
      crazysdk.requestBanner(request);
    }
  };

  crazysdk.removeBanner = (id) => {
    const container = document.getElementById(id);
    if (container) {
      container.remove();
    }
  };

  crazysdk.displayAd = (type) => {
    if (adPromiseResolve) {
      debug('A video ad has already been requested');
      return;
    }
    if (!type || !['midgame', 'rewarded'].includes(type)) {
      debug('Wrong ad type specified', type);
      return;
    }
    return new Promise((resolve) => {
      adPromiseResolve = resolve;
      crazysdk.requestAd(type);
    });
  };

  crazysdk.hasAdBlock = () => {
    if (hasAdBlock === undefined) {
      return new Promise((resolve) => {
        crazysdk.addEventListener('adblockDetectionExecuted', function _listener(event) {
          crazysdk.removeEventListener('adblockDetectionExecuted', _listener);
          hasAdBlock = event.hasAdblock;
          resolve(hasAdBlock);
        });
      });
    }
    return Promise.resolve(hasAdBlock);
  };

  window.crazysdk = crazysdk;
}