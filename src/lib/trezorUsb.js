import TrezorConnect from '@trezor/connect-web';
import {
  buildTrezorPath,
  validateTrezorAddress,
  validateTrezorMessageSignature,
} from './trezorUsbValidation';

const REQUEST_TIMEOUT_MS = 180000;
const LOCAL_MANIFEST_EMAIL = 'developer@bitcoin-access.local';
let initializationPromise = null;

const isLocalHost = () => (
  typeof window !== 'undefined'
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
);

const configuredManifestEmail = () => (
  (process.env.REACT_APP_TREZOR_MANIFEST_EMAIL || '').trim()
);

const isValidManifestEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const getManifest = () => {
  const configuredEmail = configuredManifestEmail();
  const email = configuredEmail || (isLocalHost() ? LOCAL_MANIFEST_EMAIL : '');
  if (!email || !isValidManifestEmail(email)) {
    throw new Error('Direct Trezor connection requires a valid REACT_APP_TREZOR_MANIFEST_EMAIL configuration.');
  }

  return {
    email,
    appUrl: window.location.origin,
  };
};

const responseError = (response, fallback) => {
  const message = response?.payload?.error;
  return new Error(typeof message === 'string' && message.trim() ? message : fallback);
};

const withTimeout = (operation, fallback) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    TrezorConnect.cancel('Trezor request timed out.');
    reject(new Error(fallback));
  }, REQUEST_TIMEOUT_MS);

  Promise.resolve(operation).then(
    (result) => {
      clearTimeout(timeout);
      resolve(result);
    },
    (error) => {
      clearTimeout(timeout);
      reject(error);
    },
  );
});

const initializeTrezorConnect = async () => {
  if (!initializationPromise) {
    initializationPromise = TrezorConnect.init({
      coreMode: 'iframe',
      lazyLoad: false,
      manifest: getManifest(),
    }).catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  await initializationPromise;
};

export async function prepareTrezorConnect() {
  assertTrezorUsbSupport();
  await initializeTrezorConnect();
}

export function getTrezorUsbAvailability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'Direct Trezor connection requires a browser.' };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Direct Trezor connection requires HTTPS or localhost.' };
  }
  if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent || '')) {
    return { supported: false, reason: 'Use Chrome, Edge, Brave, or Firefox with Trezor Bridge.' };
  }
  const email = configuredManifestEmail();
  if (!isLocalHost() && (!email || !isValidManifestEmail(email))) {
    return { supported: false, reason: 'Direct Trezor connection is not configured for this site yet.' };
  }
  return { supported: true, reason: '' };
}

export function assertTrezorUsbSupport() {
  const availability = getTrezorUsbAvailability();
  if (!availability.supported) throw new Error(availability.reason);
}

export async function getVerifiedTrezorAddress({ account = 0, branch = 0, index = 0, onStatus } = {}) {
  assertTrezorUsbSupport();
  const path = buildTrezorPath({ account, branch, index });
  await initializeTrezorConnect();

  onStatus?.('Select your Trezor in the official connection window.');
  const response = await withTimeout(
    TrezorConnect.getAddress({
      path,
      coin: 'btc',
      keepSession: true,
      scriptType: 'SPENDWITNESS',
      showOnTrezor: true,
    }),
    'The Trezor address request timed out. Reconnect the device and try again.',
  );
  if (!response?.success) throw responseError(response, 'Trezor did not return an address.');

  const address = validateTrezorAddress(response.payload?.address);
  onStatus?.('Address confirmed on Trezor. Preparing the sign-in challenge.');
  return { address, path, device: response.device };
}

export async function signTrezorAuthenticationMessage({ path, address, message, device, onStatus }) {
  assertTrezorUsbSupport();
  if (!path || typeof path !== 'string') throw new Error('The verified Trezor path is missing.');
  const expectedAddress = validateTrezorAddress(address);
  if (typeof message !== 'string' || !message.trim()) throw new Error('The authentication challenge is missing.');
  await initializeTrezorConnect();

  onStatus?.('Review and approve the sign-in message on your Trezor.');
  const response = await withTimeout(
    TrezorConnect.signMessage({
      path,
      coin: 'btc',
      device,
      keepSession: false,
      message,
      hex: false,
    }),
    'The Trezor signature request timed out. Reconnect the device and try again.',
  );
  if (!response?.success) throw responseError(response, 'Trezor did not return a signature.');

  const signature = validateTrezorMessageSignature({
    expectedAddress,
    responseAddress: response.payload?.address,
    signature: response.payload?.signature,
  });
  onStatus?.('Signature received. Verifying ownership with Bitcoin Access.');
  return { address: expectedAddress, signature };
}
