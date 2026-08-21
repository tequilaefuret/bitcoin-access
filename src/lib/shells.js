export const INSUFFICIENT_SHELLS_MESSAGE =
  'Not enough shells. Your past activity stays on your profile. Send bitcoin to the connected address to unlock more.';

export function friendlyShellError(value, fallback = '') {
  const message = typeof value === 'string' ? value : value?.message || fallback;
  if (/INSUFFICIENT_SHELLS|insufficient.*(?:balance|shell)|solde insuffisant/i.test(message)) {
    return INSUFFICIENT_SHELLS_MESSAGE;
  }
  return message || fallback;
}
