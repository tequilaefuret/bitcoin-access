const AUTH_PERSONAS = {
  desktop_hot_wallet: {
    id: 'desktop_hot_wallet',
    label: 'Desktop hot wallet',
    shortLabel: 'Desktop hot',
    description: 'Best for wallet extensions on a laptop or desktop browser.',
    primaryMethod: 'direct-signature',
    pathLabel: 'Connect and sign in-browser',
    recommended: true,
    capabilities: ['injected-provider', 'walletconnect', 'message-signing']
  },
  mobile_hot_wallet: {
    id: 'mobile_hot_wallet',
    label: 'Mobile hot wallet',
    shortLabel: 'Mobile hot',
    description: 'Best when the wallet lives on your phone and you want a QR-assisted flow.',
    primaryMethod: 'mobile-qr',
    pathLabel: 'Scan, open, then sign',
    capabilities: ['walletconnect', 'deeplink', 'qr-transfer', 'message-signing']
  },
  cold_single_seed: {
    id: 'cold_single_seed',
    label: 'Cold wallet, single seed',
    shortLabel: 'Cold single',
    description: 'Best for hardware wallets or airgapped signing with one spending policy.',
    primaryMethod: 'bip322-psbt',
    pathLabel: 'Export a safe PSBT and sign offline',
    capabilities: ['qr-transfer', 'copy-paste', 'offline-signing', 'psbt-friendly']
  },
  cold_multisig: {
    id: 'cold_multisig',
    label: 'Cold wallet, multisig',
    shortLabel: 'Multisig',
    description: 'Best for treasury, shared custody, or threshold signing setups.',
    primaryMethod: 'multisig-psbt',
    pathLabel: 'Export a PSBT and coordinate signers',
    capabilities: ['qr-transfer', 'copy-paste', 'offline-signing', 'policy-coordination']
  }
};

const AUTH_METHODS = {
  directSignature: {
    id: 'direct-signature',
    label: 'Direct message signature',
    description: 'The wallet signs the login challenge directly in the browser or via WalletConnect.'
  },
  mobileQr: {
    id: 'mobile-qr',
    label: 'Mobile QR handoff',
    description: 'The login challenge is packaged for QR or deeplink handoff to a mobile wallet.'
  },
  offlineProof: {
    id: 'offline-proof',
    label: 'Offline proof package',
    description: 'The login challenge is exported so it can be signed on another device or reviewed in a cold workflow.'
  },
  bip322Psbt: {
    id: 'bip322-psbt',
    label: 'BIP-322 PSBT proof',
    description: 'A virtual, non-broadcastable PSBT proves control without moving bitcoin or paying fees.'
  },
  multisigPsbt: {
    id: 'multisig-psbt',
    label: 'Multisig BIP-322 PSBT proof',
    description: 'A virtual PSBT is signed by the required threshold of the multisig policy.'
  },
  manualSignature: {
    id: 'manual-signature',
    label: 'Portable message signature',
    description: 'The same login challenge is copied to any wallet that can sign a Bitcoin message, then the signature is pasted back.'
  }
};

const DESKTOP_CONNECTION_LAYERS = [
  {
    id: 'automatic',
    label: 'Automatic connection',
    description: 'Uses an injected provider, Wallet Standard, Sats Connect, WalletConnect, or a compatible connector exposed by the wallet.'
  },
  {
    id: 'manual',
    label: 'Other desktop wallet',
    description: 'Works without a browser integration when the wallet can sign a Bitcoin message and return the signature.'
  },
  {
    id: 'psbt',
    label: 'PSBT proof',
    description: 'Safe fallback for Native SegWit wallets that can sign PSBTs but cannot sign messages.',
    planned: false
  }
];

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeUrlSafeBase64(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeUrlSafeBase64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padding);
  const bytes = base64ToBytes(padded);
  return new TextDecoder().decode(bytes);
}

function safeOrigin(origin) {
  if (origin) return origin.replace(/\/+$/g, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function getPersona(personaId) {
  return AUTH_PERSONAS[personaId] || AUTH_PERSONAS.desktop_hot_wallet;
}

export function getPersonaList() {
  return Object.values(AUTH_PERSONAS);
}

export function getMethod(methodId) {
  return Object.values(AUTH_METHODS).find((method) => method.id === methodId) || AUTH_METHODS.directSignature;
}

export function getDesktopConnectionLayers() {
  return DESKTOP_CONNECTION_LAYERS;
}

export function getAuthModeForMethod(methodId) {
  if (['offline-proof', 'bip322-psbt', 'multisig-psbt'].includes(methodId)) return 'offline';
  if (methodId === 'mobile-qr') return 'mobile';
  if (methodId === 'manual-signature') return 'manual';
  return 'direct';
}

export function getRecommendedPersona({ isMobile = false } = {}) {
  if (isMobile) return AUTH_PERSONAS.mobile_hot_wallet;
  return AUTH_PERSONAS.desktop_hot_wallet;
}

export function parseAuthPayloadToken(token) {
  if (!token) return null;

  try {
    const parsed = JSON.parse(decodeUrlSafeBase64(token));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function encodeAuthPayloadToken(payload) {
  return encodeUrlSafeBase64(payload);
}

const WALLET_BROWSER_HANDOFFS = {
  xverse: (targetUrl) => `xverse://browser?url=${encodeURIComponent(targetUrl)}`
};

export function buildWalletBrowserLink({
  walletBrand = null,
  targetUrl = safeOrigin(),
} = {}) {
  const normalizedTargetUrl = safeOrigin(targetUrl);
  const handoff = walletBrand ? WALLET_BROWSER_HANDOFFS[walletBrand] : null;

  if (handoff) {
    return handoff(normalizedTargetUrl);
  }

  return normalizedTargetUrl;
}

export function hasWalletBrowserDeepLink(walletBrand) {
  return Boolean(walletBrand && WALLET_BROWSER_HANDOFFS[walletBrand]);
}

export function formatPersonaSummary(personaId) {
  const persona = getPersona(personaId);
  return `${persona.shortLabel}: ${persona.description}`;
}

export function extractChallengeMetadata(message) {
  if (!message || typeof message !== 'string') return {};

  return message.split('\n').reduce((accumulator, line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) return accumulator;

    const key = line.slice(0, separatorIndex).trim().toLowerCase().replace(/\s+/g, '_');
    const value = line.slice(separatorIndex + 1).trim();
    accumulator[key] = value;
    return accumulator;
  }, {});
}

export function isChallengeExpired(message, fallbackExpiresAt = null) {
  const metadata = extractChallengeMetadata(message);
  const expiresAt = metadata.expires_at || fallbackExpiresAt;

  if (!expiresAt) return false;

  const expiration = new Date(expiresAt);
  if (Number.isNaN(expiration.getTime())) return false;

  return expiration.getTime() < Date.now();
}
