export const TEXT_PREVIEW_LENGTH = 150;

export const formatMessageTimestamp = (timestamp, now = Date.now()) => {
  const date = new Date(timestamp);
  const diffMs = now - date.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

export const countBillableCharacters = (text = '') => text.replace(/\n/g, '').length;
