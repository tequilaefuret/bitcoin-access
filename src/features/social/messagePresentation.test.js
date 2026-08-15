import {
  countBillableCharacters,
  formatMessageTimestamp,
  TEXT_PREVIEW_LENGTH,
} from './messagePresentation';

const now = new Date('2026-08-15T12:00:00.000Z').getTime();

test('formats recent message ages consistently', () => {
  expect(formatMessageTimestamp('2026-08-15T11:59:45.000Z', now)).toBe('Just now');
  expect(formatMessageTimestamp('2026-08-15T11:42:00.000Z', now)).toBe('18m ago');
  expect(formatMessageTimestamp('2026-08-15T09:00:00.000Z', now)).toBe('3h ago');
});

test('uses the same billable character rule for posts and reposts', () => {
  expect(countBillableCharacters('one\ntwo')).toBe(6);
  expect(TEXT_PREVIEW_LENGTH).toBe(150);
});
