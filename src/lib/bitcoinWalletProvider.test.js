import {
  detectWalletBrand,
  normalizeSignedPsbt,
  signMessageWithProvider,
  signPsbtWithProvider,
} from './bitcoinWalletProvider';

afterEach(() => {
  delete window.phantom;
  delete window.okxwallet;
});

test('uses the standardized connector contract for direct PSBT signing', async () => {
  const psbtBase64 = btoa('psbt\u00fftest');
  const provider = {
    signPSBT: jest.fn().mockResolvedValue({ psbt: psbtBase64 }),
  };

  await expect(signPsbtWithProvider(provider, 'bc1q-address', psbtBase64)).resolves.toBe(psbtBase64);
  expect(provider.signPSBT).toHaveBeenCalledWith({
    psbt: psbtBase64,
    signInputs: [{ address: 'bc1q-address', index: 0 }],
    broadcast: false,
  });
});

test('normalizes a hexadecimal signed PSBT returned by an injected wallet', () => {
  expect(normalizeSignedPsbt('70736274ff0102')).toBe(btoa('psbt\u00ff\u0001\u0002'));
});

test('normalizes binary message signatures returned by Wallet Standard providers', async () => {
  const provider = {
    signMessage: jest.fn().mockResolvedValue({ signature: Uint8Array.from([1, 2, 3]) }),
  };

  await expect(
    signMessageWithProvider(provider, 'bc1q-address', 'authentication challenge')
  ).resolves.toBe('AQID');
});

test('uses the connector selected in Reown even when other wallets are installed', async () => {
  window.phantom = {
    bitcoin: {
      requestAccounts: jest.fn(),
      signMessage: jest.fn()
    }
  };
  window.okxwallet = {
    bitcoin: {
      signMessage: jest.fn()
    }
  };

  const provider = {
    name: 'Xverse Wallet',
    signMessage: jest.fn().mockResolvedValue('xverse-signature')
  };

  await expect(
    signMessageWithProvider(provider, 'bc1q-xverse', 'authentication challenge')
  ).resolves.toBe('xverse-signature');

  expect(detectWalletBrand(provider)).toBe('xverse');
  expect(provider.signMessage).toHaveBeenCalledWith({
    address: 'bc1q-xverse',
    message: 'authentication challenge',
    protocol: 'bip322',
  });
  expect(window.phantom.bitcoin.signMessage).not.toHaveBeenCalled();
  expect(window.okxwallet.bitcoin.signMessage).not.toHaveBeenCalled();
});

test('uses the standard request contract when the connector has no signMessage method', async () => {
  const provider = {
    request: jest.fn().mockResolvedValue({ signature: 'request-signature' })
  };

  await expect(
    signMessageWithProvider(provider, 'bc1q-address', 'authentication challenge')
  ).resolves.toBe('request-signature');

  expect(provider.request).toHaveBeenCalledWith({
    method: 'signMessage',
    params: {
      address: 'bc1q-address',
      message: 'authentication challenge',
      protocol: 'bip322',
    }
  });
});

test('falls back to the historical signMessage contract only when BIP-322 is unsupported', async () => {
  const unsupported = Object.assign(new Error('BIP-322 protocol not supported'), { code: 4200 });
  const provider = {
    signMessage: jest.fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce('legacy-signature')
  };

  await expect(
    signMessageWithProvider(provider, '1legacy-address', 'authentication challenge')
  ).resolves.toBe('legacy-signature');
  expect(provider.signMessage).toHaveBeenNthCalledWith(2, {
    address: '1legacy-address',
    message: 'authentication challenge',
  });
});

test('does not retry message signing after a user rejection', async () => {
  const rejection = Object.assign(new Error('User rejected the request'), { code: 4001 });
  const provider = { signMessage: jest.fn().mockRejectedValue(rejection) };

  await expect(
    signMessageWithProvider(provider, 'bc1q-address', 'authentication challenge')
  ).rejects.toThrow('User rejected');
  expect(provider.signMessage).toHaveBeenCalledTimes(1);
});
