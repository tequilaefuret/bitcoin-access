import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ThreadStep from './ThreadStep';

jest.mock('../social/MessageCard', () => ({ message, onComment }) => (
  <article data-testid="thread-message">
    <span>{message.id}</span>
    <button
      type="button"
      aria-label={`Reply to ${message.id}`}
      onClick={() => onComment(message.id, 'A new reply', [], jest.fn())}
    >
      Reply
    </button>
  </article>
));

const root = {
  id: 'root',
  bitcoin_address: 'bc1qauthor',
  content: 'Root post',
  created_at: '2026-08-23T10:00:00.000Z',
};

const recentComments = [
  { id: 'newer', parent_id: 'root', useful_count: 1, created_at: '2026-08-23T12:00:00.000Z' },
  { id: 'older-popular', parent_id: 'root', useful_count: 8, created_at: '2026-08-23T11:00:00.000Z' },
];

const usefulComments = [recentComments[1], recentComments[0]];

const getReplyIds = () => screen.getAllByTestId('thread-message')
  .slice(1)
  .map((card) => within(card).getByText(/newer|older-popular|published/).textContent);

const renderThread = (overrides = {}) => {
  const onLoadThread = jest.fn((messageId, sort) => Promise.resolve({
    root,
    comments: sort === 'useful' ? usefulComments : recentComments,
    focus_id: messageId,
  }));
  const props = {
    messageId: 'root',
    currentAddress: 'bc1qviewer',
    displayName: 'Danaus user',
    avatarUrl: 'https://cdn.example/avatar.jpg',
    onBack: jest.fn(),
    onOpenProfile: jest.fn(),
    onOpenThread: jest.fn(),
    onPublishMessage: jest.fn().mockResolvedValue({
      success: true,
      message: {
        id: 'published',
        bitcoin_address: 'bc1qviewer',
        parent_id: 'root',
        content: 'A new reply',
        created_at: '2026-08-23T13:00:00.000Z',
      },
    }),
    onLoadComments: jest.fn(),
    onLoadThread,
    onToggleUseful: jest.fn(),
    onRepostMessage: jest.fn(),
    onBalanceUpdated: jest.fn(),
    ...overrides,
  };
  return { ...render(<ThreadStep {...props} />), props };
};

test('loads replies from newest to oldest by default and prepends a published reply', async () => {
  const { props } = renderThread();

  await waitFor(() => expect(props.onLoadThread).toHaveBeenCalledWith('root', 'recent'));
  await screen.findByText('newer');
  expect(getReplyIds()).toEqual(['newer', 'older-popular']);

  fireEvent.click(screen.getByRole('button', { name: 'Reply to root' }));

  await waitFor(() => expect(props.onPublishMessage).toHaveBeenCalledWith('A new reply', 'root', []));
  await screen.findByText('published');
  expect(getReplyIds()).toEqual(['published', 'newer', 'older-popular']);
  expect(within(screen.getAllByTestId('thread-message')[1]).getByText('published')).toBeInTheDocument();
});

test('reloads only when another reply reading mode is selected', async () => {
  const { props } = renderThread();
  await screen.findByText('newer');

  fireEvent.click(screen.getByRole('button', { name: 'Sort replies: Recent' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Recent' }));
  expect(props.onLoadThread).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sort replies: Recent' }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu', { name: 'Reply reading mode' })).not.toBeInTheDocument();
  expect(props.onLoadThread).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sort replies: Recent' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Useful' }));

  await waitFor(() => expect(props.onLoadThread).toHaveBeenLastCalledWith('root', 'useful'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sort replies: Useful' })).toBeInTheDocument());
  expect(getReplyIds()).toEqual(['older-popular', 'newer']);
});
