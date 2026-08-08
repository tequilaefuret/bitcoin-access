function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

const isByteArray = (value) => value instanceof Uint8Array || Array.isArray(value);

const PSBT_MAGIC_HEX = '70736274ff';

const psbtCandidate = (value) => (
  typeof value === 'string'
    ? value
    : value?.psbt
      || value?.signedPsbt
      || value?.result?.psbt
      || value?.result?.signedPsbt
      || null
);

export function normalizeSignedPsbt(value) {
  const candidate = psbtCandidate(value)?.trim?.();
  if (!candidate) throw new Error('The wallet did not return a signed PSBT.');

  if (/^[0-9a-f]+$/i.test(candidate) && candidate.toLowerCase().startsWith(PSBT_MAGIC_HEX)) {
    const bytes = Uint8Array.from(candidate.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
    return bytesToBase64(bytes);
  }

  try {
    const binary = atob(candidate.replace(/-/g, '+').replace(/_/g, '/'));
    const magic = [...binary.slice(0, 5)]
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    if (magic === PSBT_MAGIC_HEX) return candidate;
  } catch {
    // A clear format error is returned below.
  }

  throw new Error('The wallet returned an invalid PSBT format.');
}

export function normalizeBitcoinSignature(signature) {
  if (!signature) return signature;

  if (typeof signature === 'string') {
    return signature;
  }

  if (signature?.signature && typeof signature.signature === 'string') {
    return signature.signature;
  }

  if (isByteArray(signature?.signature)) {
    return bytesToBase64(new Uint8Array(signature.signature));
  }

  if (isByteArray(signature?.result?.signature)) {
    return bytesToBase64(new Uint8Array(signature.result.signature));
  }

  return signature?.result?.signature || signature;
}

const isUnsupportedBip322Error = (error) => {
  const code = Number(error?.code);
  const message = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return code === -32601
    || code === 4200
    || /method[^.]*not supported/.test(message)
    || /unsupported[^.]*protocol/.test(message)
    || /protocol[^.]*not supported/.test(message)
    || /bip.?322[^.]*(?:unsupported|not supported)/.test(message);
};

export function detectWalletBrand(provider) {
  const providerName = provider?.name?.toLowerCase?.() || '';

  if (providerName.includes('phantom')) return 'phantom';
  if (providerName.includes('okx')) return 'okx';
  if (providerName.includes('xverse')) return 'xverse';
  if (providerName.includes('leather')) return 'leather';

  return providerName || 'unknown';
}

export function detectWalletCapabilities(provider) {
  const walletConnectMethods = provider?.provider?.session?.namespaces?.bip122?.methods
    || provider?.session?.namespaces?.bip122?.methods
    || [];
  return {
    supportsMessageSigning: Boolean(provider?.signMessage || provider?.request),
    supportsPsbt: Boolean(
      provider?.signPSBT
      || provider?.signPsbt
      || walletConnectMethods.includes('signPsbt')
    ),
    supportsWalletConnect: true
  };
}

export async function signPsbtWithProvider(provider, address, psbtBase64) {
  const signInputs = [{ address, index: 0 }];

  if (typeof provider?.signPSBT === 'function') {
    const response = await provider.signPSBT({
      psbt: psbtBase64,
      signInputs,
      broadcast: false,
    });
    return normalizeSignedPsbt(response);
  }

  if (typeof provider?.signPsbt === 'function') {
    const binary = atob(psbtBase64);
    const psbtHex = [...binary]
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    const response = await provider.signPsbt(psbtHex, {
      autoFinalized: false,
      toSignInputs: signInputs,
    });
    return normalizeSignedPsbt(response);
  }

  if (typeof provider?.request === 'function') {
    const response = await provider.request({
      method: 'signPsbt',
      params: {
        account: address,
        psbt: psbtBase64,
        signInputs,
        broadcast: false,
      },
    });
    return normalizeSignedPsbt(response);
  }

  throw new Error('This wallet does not support direct PSBT signing. Use QR or file transfer instead.');
}

export async function signMessageWithProvider(provider, address, message) {
  if (typeof provider?.signMessage === 'function') {
    let signature;
    try {
      signature = await provider.signMessage({
        address,
        message,
        protocol: 'bip322',
      });
    } catch (error) {
      if (!isUnsupportedBip322Error(error)) throw error;
      signature = await provider.signMessage({ address, message });
    }
    return normalizeBitcoinSignature(signature);
  }

  if (typeof provider?.request === 'function') {
    let signature;
    try {
      signature = await provider.request({
        method: 'signMessage',
        params: { address, message, protocol: 'bip322' }
      });
    } catch (error) {
      if (!isUnsupportedBip322Error(error)) throw error;
      signature = await provider.request({
        method: 'signMessage',
        params: { address, message }
      });
    }
    return normalizeBitcoinSignature(signature);
  }

  throw new Error('This wallet cannot sign messages in the current session.');
}
