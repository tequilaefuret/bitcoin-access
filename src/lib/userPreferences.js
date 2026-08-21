export const DEFAULT_USER_PREFERENCES = Object.freeze({
  defaultFeed: 'for_you',
  motion: 'system',
  addressDisplay: 'shortened',
  balanceDisplay: 'show_all',
});

const VALID_FEEDS = new Set(['for_you', 'recent', 'followed']);
const VALID_MOTION_SETTINGS = new Set(['system', 'full', 'reduced']);
const VALID_ADDRESS_SETTINGS = new Set(['full', 'shortened', 'masked']);
const VALID_BALANCE_SETTINGS = new Set(['show_all', 'hide_all', 'hide_bitcoin', 'hide_shells']);

const storageKey = (address) => `danaus_preferences:${address || 'anonymous'}`;

export function normalizeUserPreferences(value = {}) {
  return {
    defaultFeed: VALID_FEEDS.has(value.defaultFeed)
      ? value.defaultFeed
      : DEFAULT_USER_PREFERENCES.defaultFeed,
    motion: VALID_MOTION_SETTINGS.has(value.motion)
      ? value.motion
      : DEFAULT_USER_PREFERENCES.motion,
    addressDisplay: VALID_ADDRESS_SETTINGS.has(value.addressDisplay)
      ? value.addressDisplay
      : value.showFullAddress === true
        ? 'full'
        : DEFAULT_USER_PREFERENCES.addressDisplay,
    balanceDisplay: VALID_BALANCE_SETTINGS.has(value.balanceDisplay)
      ? value.balanceDisplay
      : DEFAULT_USER_PREFERENCES.balanceDisplay,
  };
}

export function loadUserPreferences(address) {
  if (typeof window === 'undefined' || !address) return { ...DEFAULT_USER_PREFERENCES };

  try {
    return normalizeUserPreferences(JSON.parse(localStorage.getItem(storageKey(address)) || '{}'));
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

export function saveUserPreferences(address, preferences) {
  const normalized = normalizeUserPreferences(preferences);
  if (typeof window !== 'undefined' && address) {
    localStorage.setItem(storageKey(address), JSON.stringify(normalized));
  }
  return normalized;
}

export function shouldReduceMotion(preference) {
  if (preference === 'reduced') return true;
  if (preference === 'full') return false;
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
