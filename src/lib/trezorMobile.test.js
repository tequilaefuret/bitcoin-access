import {
  buildTrezorCallbackUrl,
  buildTrezorSuiteRequestUrl,
  createTrezorHandoffState,
  getMobilePlatform,
  getTrezorMobileAvailability,
  isTrezorHandoffFresh,
  parseTrezorSuiteCallback,
} from './trezorMobile';

const STATE = '12'.repeat(24);

test('distinguishes iPadOS and Android without trusting an in-app browser name', () => {
  expect(getMobilePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile' })).toEqual({
    android: true,
    ios: false,
    mobile: true,
  });
  expect(getMobilePlatform({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toEqual({
    android: false,
    ios: true,
    mobile: true,
  });
});

test('uses cable on Android with WebUSB and Trezor Suite otherwise', () => {
  const secureWindow = { isSecureContext: true };
  expect(getTrezorMobileAvailability(secureWindow, {
    userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
    usb: {},
  })).toEqual(expect.objectContaining({ supported: true, mode: 'direct-cable' }));
  expect(getTrezorMobileAvailability(secureWindow, {
    userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Mobile',
  })).toEqual(expect.objectContaining({ supported: true, mode: 'suite-app' }));
});

test('builds an allow-listed Trezor Suite request with a same-site callback', () => {
  const callbackUrl = buildTrezorCallbackUrl({
    origin: 'https://danaus.example',
    pathname: '/connect',
    state: STATE,
    requestId: 1,
  });
  const request = new URL(buildTrezorSuiteRequestUrl({
    method: 'getAddress',
    params: { coin: 'btc', path: "m/84'/0'/0'/0/0" },
    callbackUrl,
  }));

  expect(request.origin).toBe('https://connect.trezor.io');
  expect(request.searchParams.get('method')).toBe('getAddress');
  expect(new URL(request.searchParams.get('callback')).origin).toBe('https://danaus.example');
  expect(() => buildTrezorSuiteRequestUrl({ method: 'signTransaction', callbackUrl })).toThrow('Unsupported');
});

test('parses only correlated successful Trezor Suite callbacks', () => {
  const response = encodeURIComponent(JSON.stringify({ success: true, payload: { address: 'bc1qtest' } }));
  expect(parseTrezorSuiteCallback(
    `https://danaus.example/?trezor_state=${STATE}&id=1&response=${response}`
  )).toEqual(expect.objectContaining({ requestId: 1, state: STATE }));
  expect(parseTrezorSuiteCallback('https://danaus.example/')).toBeNull();
  expect(() => parseTrezorSuiteCallback(
    `https://danaus.example/?trezor_state=${STATE}&id=1&response=${encodeURIComponent(JSON.stringify({ success: false }))}`
  )).toThrow('rejected');
});

test('creates high-entropy state and expires abandoned handoffs', () => {
  const random = { getRandomValues: (bytes) => bytes.fill(7) };
  expect(createTrezorHandoffState(random)).toBe('07'.repeat(24));
  expect(isTrezorHandoffFresh({ createdAt: 1_000 }, 2_000)).toBe(true);
  expect(isTrezorHandoffFresh({ createdAt: 1_000 }, 1_000 + 16 * 60 * 1000)).toBe(false);
});

