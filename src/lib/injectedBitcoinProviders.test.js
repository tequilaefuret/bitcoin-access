import { getInjectedBitcoinProviders, selectBitcoinAccount } from './injectedBitcoinProviders';
import { getWallets } from '@wallet-standard/app';

test('does not use the deprecated Phantom global provider', () => {
  const provider = { requestAccounts: jest.fn(), signMessage: jest.fn() };
  expect(getInjectedBitcoinProviders({ phantom: { bitcoin: provider } })).toEqual([]);
});

test('adapts wallets that advertise Bitcoin authentication through Wallet Standard', async () => {
  const account = {
    address: 'bc1q-standard',
    publicKey: Uint8Array.from([2, 3]),
    chains: ['bitcoin:mainnet'],
    features: ['bitcoin:signMessage'],
  };
  const connect = jest.fn().mockResolvedValue({ accounts: [account] });
  const signMessage = jest.fn().mockResolvedValue([{ signature: Uint8Array.from([1, 2, 3]) }]);
  const unregister = getWallets().register({
    version: '1.0.0',
    name: 'Standard Bitcoin Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: ['bitcoin:mainnet'],
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: jest.fn() },
      'standard:events': { version: '1.0.0', on: jest.fn() },
      'bitcoin:connect': { version: '1.0.0', connect },
      'bitcoin:signMessage': { version: '1.0.0', signMessage },
    },
  });

  try {
    const wallet = getInjectedBitcoinProviders(window).find(({ name }) => name === 'Standard Bitcoin Wallet');
    await expect(wallet.provider.requestAccounts()).resolves.toEqual([
      expect.objectContaining({ address: 'bc1q-standard', purpose: 'payment' }),
    ]);
    await expect(wallet.provider.signMessage({
      address: account.address,
      message: 'challenge',
    })).resolves.toEqual({ signature: Uint8Array.from([1, 2, 3]) });
    expect(connect).toHaveBeenCalledWith({ purposes: ['payment', 'ordinals'] });
    expect(signMessage).toHaveBeenCalledWith({
      account: expect.objectContaining({ address: account.address }),
      message: new TextEncoder().encode('challenge'),
    });
  } finally {
    unregister();
  }
});

test('ignores Wallet Standard wallets without a Bitcoin signing capability', () => {
  const unregister = getWallets().register({
    version: '1.0.0',
    name: 'Connect Only Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: ['bitcoin:mainnet'],
    accounts: [],
    features: {
      'bitcoin:connect': { version: '1.0.0', connect: jest.fn() },
    },
  });
  try {
    expect(getInjectedBitcoinProviders(window).some(({ name }) => name === 'Connect Only Wallet')).toBe(false);
  } finally {
    unregister();
  }
});

test('adapts the Xverse WBIP provider to the common contract', async () => {
  const source = {
    request: jest.fn()
      .mockResolvedValueOnce({ result: { addresses: [{ address: 'bc1q-payment', purpose: 'payment' }] } })
      .mockResolvedValueOnce({ result: { signature: 'xverse-signature' } }),
  };
  const [wallet] = getInjectedBitcoinProviders({
    XverseProviders: { BitcoinProvider: source },
  });

  await expect(wallet.provider.requestAccounts()).resolves.toEqual([
    { address: 'bc1q-payment', purpose: 'payment' },
  ]);
  await expect(wallet.provider.signMessage({
    address: 'bc1q-payment',
    message: 'challenge',
  })).resolves.toEqual({ signature: 'xverse-signature' });
  expect(source.request).toHaveBeenNthCalledWith(1, 'wallet_connect', {
    addresses: ['payment'],
    network: 'Mainnet',
    message: 'Sign in to Bitcoin Access',
  });
  expect(source.request).toHaveBeenNthCalledWith(2, 'signMessage', {
    address: 'bc1q-payment',
    message: 'challenge',
    protocol: 'BIP322',
  });
});

test('supports a generic WBIP provider and ignores a duplicate Xverse alias', () => {
  const provider = { request: jest.fn() };
  expect(getInjectedBitcoinProviders({
    XverseProviders: { BitcoinProvider: provider },
    BitcoinProvider: provider,
  })).toHaveLength(1);

  expect(getInjectedBitcoinProviders({ BitcoinProvider: provider })[0].name).toBe('Bitcoin wallet');
});

test('adapts the Leather RPC provider to the common contract', async () => {
  const source = {
    request: jest.fn()
      .mockResolvedValueOnce({ result: { addresses: [{ address: 'bc1p-payment', purpose: 'payment' }] } })
      .mockResolvedValueOnce({ result: { signature: 'leather-signature' } }),
  };
  const [wallet] = getInjectedBitcoinProviders({ LeatherProvider: source });

  await expect(wallet.provider.requestAccounts()).resolves.toEqual([
    { address: 'bc1p-payment', purpose: 'payment' },
  ]);
  await expect(wallet.provider.signMessage({
    address: 'bc1p-payment',
    message: 'challenge',
  })).resolves.toEqual({ signature: 'leather-signature' });
  expect(source.request).toHaveBeenNthCalledWith(2, 'signMessage', {
    message: 'challenge',
    paymentType: 'p2tr',
    network: 'mainnet',
  });
});

test('adapts UniSat-style providers and string accounts', async () => {
  const source = {
    requestAccounts: jest.fn().mockResolvedValue(['bc1q-payment']),
    signMessage: jest.fn().mockResolvedValue('unisat-signature'),
    signPsbt: jest.fn(),
  };
  const [wallet] = getInjectedBitcoinProviders({ unisat: source });

  await expect(wallet.provider.requestAccounts()).resolves.toEqual([
    { address: 'bc1q-payment', purpose: 'payment' },
  ]);
  await expect(wallet.provider.signMessage({ message: 'challenge' })).resolves.toBe('unisat-signature');
  expect(source.signMessage).toHaveBeenCalledWith('challenge', 'bip322-simple');
});

test('prefers the payment account over the ordinals account', () => {
  const accounts = [
    { address: 'bc1p-ordinals', purpose: 'ordinals' },
    { address: 'bc1q-payment', purpose: 'payment' },
  ];
  expect(selectBitcoinAccount(accounts)).toEqual(accounts[1]);
});
