import {
  getAuthModeForMethod,
  getDesktopConnectionLayers,
  getMethod,
  getRecommendedPersona
} from './index';

test('maps every authentication method to a transport mode', () => {
  expect(getAuthModeForMethod('direct-signature')).toBe('direct');
  expect(getAuthModeForMethod('manual-signature')).toBe('manual');
  expect(getAuthModeForMethod('mobile-qr')).toBe('mobile');
  expect(getAuthModeForMethod('offline-proof')).toBe('offline');
  expect(getAuthModeForMethod('bip322-psbt')).toBe('offline');
  expect(getAuthModeForMethod('multisig-psbt')).toBe('offline');
  expect(getMethod('manual-signature').label).toBe('Portable message signature');
});

test('defaults to a browser wallet on desktop before providers are discovered', () => {
  expect(getRecommendedPersona({ isMobile: false, hasInjectedProvider: false }).id).toBe(
    'desktop_hot_wallet'
  );
  expect(getRecommendedPersona({ isMobile: true }).id).toBe('mobile_hot_wallet');
});

test('keeps automatic, manual, and PSBT desktop coverage as separate layers', () => {
  expect(getDesktopConnectionLayers().map((layer) => layer.id)).toEqual([
    'automatic',
    'manual',
    'psbt'
  ]);
  expect(getDesktopConnectionLayers().find((layer) => layer.id === 'psbt').planned).toBe(false);
});
