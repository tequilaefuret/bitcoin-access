import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostMediaViewer from './PostMediaViewer';

const photos = [
  { url: 'https://media.example/one.webp', width: 1200, height: 900 },
  { url: 'https://media.example/two.webp', width: 900, height: 1200 },
];

const message = {
  id: 'message-with-photos',
  bitcoin_address: 'bc1q-author',
  display_name: 'author',
  content: 'Focused publication',
  created_at: '2026-08-23T12:00:00Z',
  useful_count: 2,
  comments_count: 1,
  reposts_count: 3,
  media: photos,
};

const setDesktopViewport = (matches) => {
  window.matchMedia = jest.fn().mockReturnValue({
    matches,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
};

const dispatchPointer = (target, type, properties) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(properties).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value });
  });
  fireEvent(target, event);
};

afterEach(() => {
  delete window.matchMedia;
});

test('opens photos in a modal, navigates them, and exposes social actions', async () => {
  setDesktopViewport(false);
  const onUseful = jest.fn().mockResolvedValue({ active: true, useful_count: 3 });
  const onClose = jest.fn();
  render(
    <PostMediaViewer
      message={message}
      photos={photos}
      currentAddress="bc1q-reader"
      onClose={onClose}
      onUseful={onUseful}
      onComment={jest.fn()}
      onRepost={jest.fn()}
    />
  );

  expect(screen.getByRole('dialog', { name: /photo viewer/i })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /attachment 1 enlarged/i })).toHaveAttribute('src', photos[0].url);
  fireEvent.click(screen.getByRole('button', { name: /next photo/i }));
  expect(screen.getByRole('img', { name: /attachment 2 enlarged/i })).toHaveAttribute('src', photos[1].url);

  fireEvent.click(screen.getByRole('button', { name: /useful 2/i }));
  await waitFor(() => expect(onUseful).toHaveBeenCalledWith(message.id));
  expect(await screen.findByRole('button', { name: /useful 3/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /close photo viewer/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('loads a scrollable desktop discussion panel and focuses the selected message', async () => {
  setDesktopViewport(true);
  const onLoadThread = jest.fn().mockResolvedValue({
    root: message,
    comments: [{
      id: 'reply-1',
      bitcoin_address: 'bc1q-reader',
      display_name: 'reader',
      content: 'A reply below the focused publication',
      created_at: '2026-08-23T12:01:00Z',
      media: [],
    }],
    focus_id: message.id,
    new_balance: 998,
    cost: 1,
  });

  render(
    <PostMediaViewer
      message={message}
      photos={photos}
      currentAddress="bc1q-reader"
      onClose={jest.fn()}
      onLoadThread={onLoadThread}
    />
  );

  await waitFor(() => expect(onLoadThread).toHaveBeenCalledWith(message.id));
  expect(await screen.findByText('A reply below the focused publication')).toBeInTheDocument();
  expect(screen.getByText(/scroll to read the post and its replies/i)).toBeInTheDocument();
});

test('hides mobile controls on a tap and supports pinch zoom', () => {
  setDesktopViewport(false);
  render(
    <PostMediaViewer
      message={message}
      photos={photos}
      currentAddress="bc1q-reader"
      onClose={jest.fn()}
    />
  );

  const surface = screen.getByTestId('photo-interaction-surface');
  const actions = screen.getByTestId('photo-viewer-actions');
  dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 80, clientY: 80 });
  dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 80, clientY: 80 });
  expect(actions).toHaveClass('translate-y-full');

  dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 50 });
  dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 120, clientY: 50 });
  dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 220, clientY: 50 });
  expect(screen.getByRole('img', { name: /attachment 1 enlarged/i }).style.transform)
    .toContain('scale(2)');
});
