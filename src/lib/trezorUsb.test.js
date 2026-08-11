import {
  assertTrezorInteger,
  buildTrezorPath,
  validateTrezorAddress,
  validateTrezorMessageSignature,
} from './trezorUsbValidation';
import {
  getVerifiedTrezorAddress,
  signTrezorAuthenticationMessage,
} from './trezorUsb';
import TrezorConnect from '@trezor/connect-web';

jest.mock('@trezor/connect-web', () => ({
  __esModule: true,
  default: {
    cancel: jest.fn(),
    getAddress: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    signMessage: jest.fn(),
  },
}));

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SIGNATURE = Buffer.alloc(65, 7).toString('base64');

test('builds a bounded Native SegWit Trezor path', () => {
  expect(buildTrezorPath({ account: 2, branch: 1, index: 17 })).toBe("m/84'/0'/2'/1/17");
  expect(() => buildTrezorPath({ account: 101 })).toThrow('Trezor account');
  expect(() => buildTrezorPath({ branch: 2 })).toThrow('Address chain');
  expect(() => assertTrezorInteger(1.5, 'Address index')).toThrow('Address index');
});

test('accepts only a mainnet Native SegWit address', () => {
  expect(validateTrezorAddress(ADDRESS)).toBe(ADDRESS);
  expect(() => validateTrezorAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toThrow('Native SegWit');
  expect(() => validateTrezorAddress('tb1qfm6m7u2d6mpu9ww5g874rg3az5msk02jfytsq6')).toThrow('mainnet');
});

test('binds the compact signature to the address confirmed on the device', () => {
  expect(validateTrezorMessageSignature({
    expectedAddress: ADDRESS,
    responseAddress: ADDRESS,
    signature: SIGNATURE,
  })).toBe(SIGNATURE);

  expect(() => validateTrezorMessageSignature({
    expectedAddress: ADDRESS,
    responseAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    signature: SIGNATURE,
  })).toThrow('different address');
  expect(() => validateTrezorMessageSignature({
    expectedAddress: ADDRESS,
    responseAddress: ADDRESS,
    signature: 'not-a-signature',
  })).toThrow('invalid message signature');
});

test('keeps one secure Trezor session between address verification and signing', async () => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  const device = { path: 'device-path', state: 'device-state' };
  TrezorConnect.init.mockResolvedValueOnce(undefined);
  TrezorConnect.getAddress.mockResolvedValueOnce({
    success: true,
    device,
    payload: { address: ADDRESS },
  });
  TrezorConnect.signMessage.mockResolvedValueOnce({
    success: true,
    payload: { address: ADDRESS, signature: SIGNATURE },
  });

  const verified = await getVerifiedTrezorAddress();
  await expect(signTrezorAuthenticationMessage({
    ...verified,
    message: 'Bitcoin Access authentication challenge',
  })).resolves.toEqual({ address: ADDRESS, signature: SIGNATURE });

  expect(TrezorConnect.init).toHaveBeenCalledWith(expect.objectContaining({
    coreMode: 'iframe',
    lazyLoad: false,
  }));
  expect(TrezorConnect.getAddress).toHaveBeenCalledWith(expect.objectContaining({
    keepSession: true,
    showOnTrezor: true,
  }));
  expect(TrezorConnect.signMessage).toHaveBeenCalledWith(expect.objectContaining({
    device,
    keepSession: false,
  }));
});
