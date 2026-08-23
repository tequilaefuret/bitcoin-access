import { fireEvent, render, screen } from '@testing-library/react';
import StatsModal, { groupConsecutiveHistory } from './StatsModal';

const history = [
  { id: 'read-2', type: 'read_messages', event_key: 'read_messages', amount: -20, action_count: 20, created_at: '2026-08-21T12:10:00Z' },
  { id: 'read-1', type: 'read_messages', event_key: 'read_messages', amount: -20, action_count: 20, created_at: '2026-08-21T12:00:00Z' },
  { id: 'useful-1', type: 'useful', event_key: 'useful', amount: -1, action_count: 1, created_at: '2026-08-21T11:00:00Z' },
];

test('groups only consecutive similar events and totals their actions and shells', () => {
  const grouped = groupConsecutiveHistory(history);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({ event_key: 'read_messages', amount: -40, action_count: 40 });
  expect(grouped[0].start_at).toBe('2026-08-21T12:00:00Z');
  expect(grouped[0].end_at).toBe('2026-08-21T12:10:00Z');
});

test('renders grouped history, loads older events, and closes from the backdrop', () => {
  const onClose = jest.fn();
  const onLoadMore = jest.fn();
  render(<StatsModal stats={{ history, hasMore: true }} onClose={onClose} onLoadMore={onLoadMore} />);

  expect(screen.getByText('40 messages loaded')).toBeInTheDocument();
  expect(screen.getByText('-40 shells')).toBeInTheDocument();
  expect(screen.queryByText(/feed reading/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /show 20 previous events/i }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);

  fireEvent.mouseDown(screen.getByRole('dialog').parentElement);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('describes profile media locks and unlocks as separate events', () => {
  render(
    <StatsModal
      stats={{
        history: [
          { id: 'lock', event_key: 'profile_avatar_lock', amount: -100, action_count: 1, created_at: '2026-08-21T12:01:00Z' },
          { id: 'unlock', event_key: 'profile_avatar_unlock', amount: 80, action_count: 1, created_at: '2026-08-21T12:00:00Z' },
        ],
        hasMore: false,
      }}
      onClose={jest.fn()}
    />
  );

  expect(screen.getByText('100 shells locked for the profile photo')).toBeInTheDocument();
  expect(screen.getByText('80 shells unlocked from the profile photo')).toBeInTheDocument();
});

test('shows text and photo refunds when a publication is deleted', () => {
  render(
    <StatsModal
      stats={{
        history: [
          { id: 'text-refund', event_key: 'message_text_unlock', amount: 42, action_count: 1, created_at: '2026-08-21T12:01:00Z' },
          { id: 'photo-refund', event_key: 'message_media_unlock', amount: 353, action_count: 1, created_at: '2026-08-21T12:00:00Z' },
        ],
        hasMore: false,
      }}
      onClose={jest.fn()}
    />
  );

  expect(screen.getByText('42 text shells unlocked from a deleted message')).toBeInTheDocument();
  expect(screen.getByText('353 photo shells unlocked from a deleted message')).toBeInTheDocument();
});
