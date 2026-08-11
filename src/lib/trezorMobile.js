const TREZOR_DEEPLINK_URL = 'https://connect.trezor.io/9/deeplink/1/';
const ALLOWED_METHODS = new Set(['getAddress', 'signMessage']);
const MAX_CALLBACK_LENGTH = 20_000;

export const TREZOR_MOBILE_STORAGE_KEY = 'danaus_trezor_mobile_handoff';
export const TREZOR_MOBILE_TTL_MS = 15 * 60 * 1000;

export function getMobilePlatform(browserNavigator = typeof navigator === 'undefined' ? undefined : navigator) {
  const userAgent = browserNavigator?.userAgent || '';
  const isIPadOs = browserNavigator?.platform === 'MacIntel' && browserNavigator?.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || isIPadOs;
  const android = /Android/i.test(userAgent);
  return { android, ios, mobile: android || ios || /Mobi/i.test(userAgent) };
}

export function getTrezorMobileAvailability(
  browserWindow = typeof window === 'undefined' ? undefined : window,
  browserNavigator = typeof navigator === 'undefined' ? undefined : navigator,
) {
  if (!browserWindow || !browserNavigator) {
    return { supported: false, mode: 'unavailable', reason: 'Trezor mobile connection requires a browser.' };
  }
  if (!browserWindow.isSecureContext) {
    return { supported: false, mode: 'unavailable', reason: 'Trezor mobile connection requires HTTPS.' };
  }

  const platform = getMobilePlatform(browserNavigator);
  if (!platform.mobile) {
    return { supported: false, mode: 'unavailable', reason: 'This is not a mobile browser.' };
  }
  if (platform.android && browserNavigator.usb) {
    return {
      supported: true,
      mode: 'direct-cable',
      actionLabel: 'Connect Trezor',
      reason: '',
    };
  }

  return {
    supported: true,
    mode: 'suite-app',
    actionLabel: 'Connect Trezor',
    reason: platform.ios
      ? 'Requires Trezor Suite and a Bluetooth-compatible Trezor such as Safe 7.'
      : 'Continue securely in the Trezor Suite mobile app.',
  };
}

export function createTrezorHandoffState(browserCrypto = typeof crypto === 'undefined' ? undefined : crypto) {
  if (!browserCrypto?.getRandomValues) throw new Error('Secure random generation is unavailable in this browser.');
  const bytes = new Uint8Array(24);
  browserCrypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function buildTrezorCallbackUrl({ origin, pathname, state, requestId }) {
  if (!state || !/^[0-9a-f]{48}$/i.test(state)) throw new Error('Invalid Trezor handoff state.');
  if (![1, 2].includes(requestId)) throw new Error('Invalid Trezor handoff request.');

  const callback = new URL(pathname || '/', origin);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
  if (callback.protocol !== 'https:' && !(isLocal && callback.protocol === 'http:')) {
    throw new Error('Trezor Suite handoff requires HTTPS.');
  }
  callback.searchParams.set('trezor_state', state);
  callback.searchParams.set('id', String(requestId));
  return callback.toString();
}

export function buildTrezorSuiteRequestUrl({ method, params, callbackUrl }) {
  if (!ALLOWED_METHODS.has(method)) throw new Error('Unsupported Trezor Suite request.');
  const callback = new URL(callbackUrl);
  const request = new URL(TREZOR_DEEPLINK_URL);
  request.searchParams.set('method', method);
  request.searchParams.set('params', JSON.stringify(params || {}));
  request.searchParams.set('callback', callback.toString());
  return request.toString();
}

export function parseTrezorSuiteCallback(urlValue) {
  const url = new URL(urlValue);
  const state = url.searchParams.get('trezor_state');
  if (!state) return null;
  if (!/^[0-9a-f]{48}$/i.test(state)) throw new Error('Invalid Trezor callback state.');

  const requestId = Number(url.searchParams.get('id'));
  if (![1, 2].includes(requestId)) throw new Error('Invalid Trezor callback request.');
  const rawResponse = url.searchParams.get('response');
  if (!rawResponse || rawResponse.length > MAX_CALLBACK_LENGTH) {
    throw new Error('Trezor Suite did not return a valid response.');
  }

  let response;
  try {
    response = JSON.parse(rawResponse);
  } catch {
    throw new Error('Unable to read the Trezor Suite response.');
  }
  if (!response?.success) {
    const message = typeof response?.payload === 'string'
      ? response.payload
      : response?.payload?.error || response?.error;
    throw new Error(typeof message === 'string' ? message : 'The Trezor request was rejected.');
  }
  return { requestId, response, state };
}

export function isTrezorHandoffFresh(pending, now = Date.now()) {
  return Boolean(
    pending
    && typeof pending.createdAt === 'number'
    && pending.createdAt <= now
    && now - pending.createdAt <= TREZOR_MOBILE_TTL_MS
  );
}
