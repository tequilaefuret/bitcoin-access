import { OperationError } from './operation-error.mjs';

export const FEED_BATCH_SIZE = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_CONTEXT_KEY = '__danaus_feed_page';

export function encodeFeedCursor(cursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeFeedCursor(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 256) {
    throw new OperationError('Curseur de pagination invalide');
  }

  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    const createdAt = typeof parsed?.createdAt === 'string' ? parsed.createdAt : '';
    const messageId = typeof parsed?.messageId === 'string' ? parsed.messageId : '';

    if (!UUID_PATTERN.test(messageId) || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error('Invalid feed cursor payload');
    }

    return { createdAt: new Date(createdAt).toISOString(), messageId };
  } catch {
    throw new OperationError('Curseur de pagination invalide');
  }
}

export function attachFeedPageContext(messages, context) {
  return messages.map((message, index) => (
    index === 0 ? { ...message, [PAGE_CONTEXT_KEY]: context } : message
  ));
}

export function extractFeedPageSnapshot(snapshot, fallbackMessages, fallbackContext) {
  const messagesWithContext = Array.isArray(snapshot) ? snapshot : fallbackMessages;
  const storedContext = messagesWithContext.find(
    (message) => message?.[PAGE_CONTEXT_KEY],
  )?.[PAGE_CONTEXT_KEY];
  const context = storedContext && typeof storedContext === 'object'
    ? {
        has_more: Boolean(storedContext.has_more),
        next_cursor: typeof storedContext.next_cursor === 'string'
          ? storedContext.next_cursor
          : null,
      }
    : fallbackContext;

  return {
    context,
    messages: messagesWithContext.map((message) => {
      const cleanMessage = { ...message };
      delete cleanMessage[PAGE_CONTEXT_KEY];
      return cleanMessage;
    }),
  };
}
