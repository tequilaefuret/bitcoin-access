import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageCard from './components/social/MessageCard';

const buildMessage = (overrides = {}) => ({
  id: 'message-1',
  bitcoin_address: 'bc1q-author',
  display_name: 'clearwriter',
  content: 'A concise contribution.',
  created_at: new Date().toISOString(),
  useful_count: 3,
  comments_count: 2,
  reposts_count: 0,
  user_has_marked_useful: false,
  ...overrides
});

test('uses Useful as the only evaluation action', async () => {
  const onUseful = jest.fn().mockResolvedValue({
    active: true,
    useful_count: 4
  });

  render(
    <MessageCard
      message={buildMessage()}
      currentAddress="bc1q-reader"
      onUseful={onUseful}
      onLoadComments={async () => []}
    />
  );

  expect(screen.queryByText(/dislike/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /useful 3/i })).toHaveAttribute(
    'title',
    'Mark as useful (costs 1 satoshi)'
  );

  fireEvent.click(screen.getByRole('button', { name: /useful 3/i }));
  expect(onUseful).toHaveBeenCalledWith('message-1');

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /useful 4/i })).toHaveAttribute(
      'title',
      'Remove Useful (free)'
    );
  });
});

test('expands posts longer than 150 characters', () => {
  const longContent = `${'A'.repeat(160)} final words`;

  render(
    <MessageCard
      message={buildMessage({ content: longContent })}
      currentAddress="bc1q-reader"
      onUseful={async () => ({ active: true, useful_count: 4 })}
      onLoadComments={async () => []}
    />
  );

  expect(screen.queryByText(longContent)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /see more/i }));
  expect(screen.getByText(longContent)).toBeInTheDocument();
});

test('offers a simple repost and a quote without a wallet-specific flow', async () => {
  const onRepost = jest.fn().mockResolvedValue({ active: true, reposts_count: 1 });
  render(
    <MessageCard
      message={buildMessage()}
      currentAddress="bc1q-reader"
      onUseful={async () => ({ active: true, useful_count: 4 })}
      onRepost={onRepost}
      onLoadComments={async () => []}
    />
  );

  fireEvent.click(screen.getByTitle('Repost'));
  fireEvent.click(screen.getByRole('button', { name: /^repost$/i }));
  await waitFor(() => expect(onRepost).toHaveBeenCalledWith('message-1', ''));

  fireEvent.click(screen.getByTitle('Repost'));
  fireEvent.click(screen.getByRole('button', { name: /^quote$/i }));
  fireEvent.change(screen.getByPlaceholderText(/why are you sharing/i), {
    target: { value: 'Useful context.' },
  });
  fireEvent.click(screen.getByRole('button', { name: /publish quote/i }));
  await waitFor(() => expect(onRepost).toHaveBeenCalledWith('message-1', 'Useful context.'));
});

test('renders the original post inside a quote', () => {
  render(
    <MessageCard
      message={buildMessage({
        id: 'quote-1',
        content: 'My perspective.',
        repost_of: 'message-1',
        repost_kind: 'quote',
        reposted_message: {
          id: 'message-1',
          bitcoin_address: 'bc1q-original',
          display_name: 'original-author',
          content: 'The original post.',
          created_at: new Date().toISOString(),
        },
      })}
      currentAddress="bc1q-reader"
      showActions={false}
    />
  );

  expect(screen.getByText('My perspective.')).toBeInTheDocument();
  expect(screen.getByText('The original post.')).toBeInTheDocument();
  expect(screen.getByText('@original-author')).toBeInTheDocument();
});
