import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SocialStep from './SocialStep';

jest.mock('../../supabaseClient', () => ({
  deleteMessage: jest.fn(),
}));

const message = {
  id: 'message-1',
  bitcoin_address: 'bc1q-author',
  display_name: 'signalwriter',
  content: 'A post selected for this reader.',
  created_at: new Date().toISOString(),
  useful_count: 2,
  comments_count: 0,
  reposts_count: 0,
};

const renderSocialStep = (overrides = {}) => {
  const onLoadMessages = jest.fn().mockResolvedValue([message]);
  const props = {
    address: 'bc1q-reader',
    onLoadMessages,
    onLoadOpinionTopics: jest.fn().mockResolvedValue([]),
    onPublishMessage: jest.fn(),
    onLoadComments: jest.fn().mockResolvedValue([]),
    onToggleUseful: jest.fn(),
    onRepostMessage: jest.fn(),
    ...overrides,
  };

  return { ...render(<SocialStep {...props} />), onLoadMessages };
};

test('opens the personalized feed by default and keeps Latest and Followed available', async () => {
  const { onLoadMessages } = renderSocialStep();

  await waitFor(() => {
    expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'for_you');
  });
  expect(screen.getByRole('button', { name: /for you/i })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: /latest/i }));
  await waitFor(() => expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'recent'));

  fireEvent.click(screen.getByRole('button', { name: /followed/i }));
  await waitFor(() => expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'followed'));
});

test('removes a not-interested recommendation and forwards the negative signal', async () => {
  const onForYouNotInterested = jest.fn().mockResolvedValue({ success: true });
  renderSocialStep({ onForYouNotInterested });

  expect(await screen.findByText('A post selected for this reader.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /not interested/i }));

  await waitFor(() => {
    expect(onForYouNotInterested).toHaveBeenCalledWith('message-1');
  });
  expect(screen.queryByText('A post selected for this reader.')).not.toBeInTheDocument();
});

test('hides an author from the visible feed after saving the preference', async () => {
  const onEditorialPreference = jest.fn().mockResolvedValue({ success: true });
  renderSocialStep({ onEditorialPreference });

  expect(await screen.findByText('A post selected for this reader.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /hide this author/i }));

  await waitFor(() => {
    expect(onEditorialPreference).toHaveBeenCalledWith('bc1q-author', 'mute');
    expect(screen.queryByText('A post selected for this reader.')).not.toBeInTheDocument();
  });
  expect(await screen.findByText(/author is now hidden/i)).toBeInTheDocument();
});

test('records a post report once through the post options menu', async () => {
  const onReportMessage = jest.fn().mockResolvedValue({ created: true, report_count: 1 });
  renderSocialStep({ onReportMessage });

  expect(await screen.findByText('A post selected for this reader.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /report this post/i }));

  await waitFor(() => {
    expect(onReportMessage).toHaveBeenCalledWith('message-1');
  });
  expect(await screen.findByText(/report recorded/i)).toBeInTheDocument();
});
