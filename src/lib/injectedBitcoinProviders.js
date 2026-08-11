import { getWallets } from '@wallet-standard/app';

const unwrapRpcResult = (response) => {
  if (response?.error) {
    const error = new Error(response.error.message || 'The wallet rejected the request.');
    error.code = response.error.code;
    throw error;
  }
  return response?.result ?? response;
};

const normalizeAccounts = (response) => {
  const result = unwrapRpcResult(response);
  const accounts = result?.addresses || result?.accounts || result;
  if (!Array.isArray(accounts)) return [];
  return accounts.map((account) => (
    typeof account === 'string'
      ? { address: account, purpose: 'payment' }
      : account
  ));
};

const bytesToHex = (base64) => [...atob(base64)]
  .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
  .join('');

const base64ToBytes = (base64) => Uint8Array.from(
  atob(base64),
  (character) => character.charCodeAt(0),
);

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const normalizeWalletStandardAccounts = (accounts) => (accounts || []).map((account, index) => ({
  ...account,
  purpose: account.purpose || (index === 0 ? 'payment' : 'ordinals'),
}));

const trackWalletStandardAccounts = (wallet) => {
  let latestAccounts = normalizeWalletStandardAccounts(wallet.accounts);
  let resolveNextChange;
  const events = wallet.features['bitcoin:events'];
  const off = typeof events?.on === 'function'
    ? events.on('change', ({ accounts } = {}) => {
      latestAccounts = normalizeWalletStandardAccounts(accounts ?? wallet.accounts);
      if (latestAccounts.length && resolveNextChange) {
        resolveNextChange(latestAccounts);
        resolveNextChange = undefined;
      }
    })
    : () => {};

  return {
    current: () => latestAccounts.length
      ? latestAccounts
      : normalizeWalletStandardAccounts(wallet.accounts),
    wait: (timeoutMs = 2500) => new Promise((resolve) => {
      const currentAccounts = latestAccounts.length
        ? latestAccounts
        : normalizeWalletStandardAccounts(wallet.accounts);
      if (currentAccounts.length) {
        resolve(currentAccounts);
        return;
      }

      const timeout = setTimeout(() => {
        resolveNextChange = undefined;
        resolve(normalizeWalletStandardAccounts(wallet.accounts));
      }, timeoutMs);
      resolveNextChange = (accounts) => {
        clearTimeout(timeout);
        resolve(accounts);
      };
    }),
    stop: () => off?.(),
  };
};

const createWalletStandardProvider = (wallet) => {
  let authorizedAccounts = [];

  const findAccount = (address) => (
    authorizedAccounts.find((account) => account.address === address)
    || wallet.accounts?.find((account) => account.address === address)
  );

  return {
    name: wallet.name,
    walletStandard: true,
    requestAccounts: async () => {
      const accountTracker = trackWalletStandardAccounts(wallet);
      try {
        const response = await wallet.features['bitcoin:connect'].connect({
          purposes: ['payment'],
        });
        authorizedAccounts = normalizeWalletStandardAccounts(response?.accounts);
        if (!authorizedAccounts.length) authorizedAccounts = accountTracker.current();
        if (!authorizedAccounts.length) authorizedAccounts = await accountTracker.wait();
        return authorizedAccounts;
      } finally {
        accountTracker.stop();
      }
    },
    signMessage: async ({ address, message }) => {
      const account = findAccount(address);
      if (!account) throw new Error('The selected address is not authorized in this wallet.');
      const [response] = await wallet.features['bitcoin:signMessage'].signMessage({
        account,
        message: new TextEncoder().encode(message),
      });
      if (!response?.signature) throw new Error('The wallet did not return a message signature.');
      return { signature: response.signature };
    },
    signPSBT: typeof wallet.features['bitcoin:signTransaction']?.signTransaction === 'function'
      ? async ({ psbt, signInputs }) => {
        const inputsToSign = signInputs.map(({ address, index }) => {
          const account = findAccount(address);
          if (!account) throw new Error('The selected address is not authorized in this wallet.');
          return { account, signingIndexes: [index], sigHash: undefined };
        });
        const [response] = await wallet.features['bitcoin:signTransaction'].signTransaction({
          psbt: base64ToBytes(psbt),
          inputsToSign,
        });
        if (!response?.signedPsbt) throw new Error('The wallet did not return a signed PSBT.');
        return { psbt: bytesToBase64(response.signedPsbt) };
      }
      : undefined,
  };
};

const getWalletStandardProviders = (browserWindow) => {
  if (typeof window === 'undefined' || browserWindow !== window) return [];

  return getWallets().get().flatMap((wallet, index) => {
    const features = wallet?.features || {};
    const supportsMainnet = wallet?.chains?.includes('bitcoin:mainnet');
    const canConnect = typeof features['bitcoin:connect']?.connect === 'function';
    const canAuthenticate = typeof features['bitcoin:signMessage']?.signMessage === 'function';
    if (!supportsMainnet || !canConnect || !canAuthenticate) return [];

    const slug = (wallet.name || 'bitcoin-wallet').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return [{
      id: `wallet-standard-${slug}-${index}`,
      name: wallet.name || 'Bitcoin wallet',
      provider: createWalletStandardProvider(wallet),
      source: wallet,
    }];
  });
};

const createWbipProvider = (name, source) => ({
  name,
  requestAccounts: async () => normalizeAccounts(await source.request('wallet_connect', {
    addresses: ['payment'],
    network: 'Mainnet',
    message: 'Sign in to Bitcoin Access',
  })),
  signMessage: async ({ address, message }) => unwrapRpcResult(await source.request('signMessage', {
    address,
    message,
    protocol: 'BIP322',
  })),
});

const createLeatherProvider = (source) => ({
  name: 'Leather',
  requestAccounts: async () => normalizeAccounts(await source.request('getAddresses')),
  signMessage: async ({ address, message }) => unwrapRpcResult(await source.request('signMessage', {
    message,
    paymentType: address.toLowerCase().startsWith('bc1p') ? 'p2tr' : 'p2wpkh',
    network: 'mainnet',
  })),
  signPSBT: async ({ psbt, signInputs }) => {
    const result = unwrapRpcResult(await source.request('signPsbt', {
      hex: bytesToHex(psbt),
      signAtIndex: signInputs.map(({ index }) => index),
      network: 'mainnet',
      broadcast: false,
    }));
    return result?.hex || result?.psbt || result;
  },
});

const createBip322SimpleProvider = (name, source) => ({
  name,
  requestAccounts: async () => normalizeAccounts(await source.requestAccounts()),
  signMessage: async ({ message }) => source.signMessage(message, 'bip322-simple'),
  signPsbt: typeof source.signPsbt === 'function'
    ? source.signPsbt.bind(source)
    : undefined,
});

const PROVIDER_DEFINITIONS = [
  {
    id: 'xverse-wbip',
    name: 'Xverse',
    getProvider: (browserWindow) => browserWindow?.XverseProviders?.BitcoinProvider,
    adapt: (provider) => createWbipProvider('Xverse', provider),
    isAvailable: (provider) => Boolean(provider?.request),
  },
  {
    id: 'wbip-bitcoin',
    name: 'Bitcoin wallet',
    getProvider: (browserWindow) => browserWindow?.BitcoinProvider,
    adapt: (provider) => createWbipProvider('Bitcoin wallet', provider),
    isAvailable: (provider) => Boolean(provider?.request),
  },
  {
    id: 'leather-rpc',
    name: 'Leather',
    getProvider: (browserWindow) => browserWindow?.LeatherProvider,
    adapt: createLeatherProvider,
    isAvailable: (provider) => Boolean(provider?.request),
  },
  {
    id: 'okx-bitcoin',
    name: 'OKX Wallet',
    getProvider: (browserWindow) => browserWindow?.okxwallet?.bitcoin,
    adapt: (provider) => createBip322SimpleProvider('OKX Wallet', provider),
    isAvailable: (provider) => Boolean(provider?.requestAccounts && provider?.signMessage),
  },
  {
    id: 'unisat-bitcoin',
    name: 'UniSat',
    getProvider: (browserWindow) => browserWindow?.unisat,
    adapt: (provider) => createBip322SimpleProvider('UniSat', provider),
    isAvailable: (provider) => Boolean(provider?.requestAccounts && provider?.signMessage),
  },
];

export function getInjectedBitcoinProviders(
  browserWindow = typeof window === 'undefined' ? undefined : window
) {
  const standardProviders = getWalletStandardProviders(browserWindow);
  const seenSources = new Set(standardProviders.map(({ source }) => source));
  const seenNames = new Set(standardProviders.map(({ name }) => name.toLowerCase()));
  const legacyProviders = PROVIDER_DEFINITIONS.flatMap((definition) => {
    const source = definition.getProvider(browserWindow);
    if (
      !definition.isAvailable(source)
      || seenSources.has(source)
      || seenNames.has(definition.name.toLowerCase())
    ) return [];
    seenSources.add(source);
    seenNames.add(definition.name.toLowerCase());
    return [{ id: definition.id, name: definition.name, provider: definition.adapt(source) }];
  });
  return [...standardProviders.map(({ source, ...provider }) => provider), ...legacyProviders];
}

export function subscribeToBitcoinProviderChanges(listener) {
  if (typeof window === 'undefined') return () => {};
  const wallets = getWallets();
  const offRegister = wallets.on('register', listener);
  const offUnregister = wallets.on('unregister', listener);
  return () => {
    offRegister();
    offUnregister();
  };
}

export function requestWalletStandardRegistration() {
  if (typeof window === 'undefined') return;
  const wallets = getWallets();

  // Extensions can load after the app's first wallet-standard:app-ready event.
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
    detail: Object.freeze({ register: wallets.register }),
  }));
}

export function selectBitcoinAccount(accounts) {
  if (!Array.isArray(accounts)) return null;
  const account = accounts.find((candidate) => candidate?.purpose === 'payment')
    || accounts.find((candidate) => candidate?.address)
    || accounts.find((candidate) => typeof candidate === 'string');
  return typeof account === 'string' ? { address: account, purpose: 'payment' } : account;
}
