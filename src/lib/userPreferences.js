export const DEFAULT_USER_PREFERENCES = Object.freeze({
  defaultFeed: 'for_you',
  motion: 'system',
  showFullAddress: false,
});

const VALID_FEEDS = new Set(['for_you', 'recent', 'followed']);
const VALID_MOTION_SETTINGS = new Set(['system', 'full', 'reduced']);

const storageKey = (address) => `danaus_preferences:${address || 'anonymous'}`;

export function normalizeUserPreferences(value = {}) {
  return {
    defaultFeed: VALID_FEEDS.has(value.defaultFeed)
      ? value.defaultFeed
      : DEFAULT_USER_PREFERENCES.defaultFeed,
    motion: VALID_MOTION_SETTINGS.has(value.motion)
      ? value.motion
      : DEFAULT_USER_PREFERENCES.motion,
    showFullAddress: typeof value.showFullAddress === 'boolean'
      ? value.showFullAddress
      : DEFAULT_USER_PREFERENCES.showFullAddress,
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
