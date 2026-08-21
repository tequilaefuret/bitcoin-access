import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SocialStep from './SocialStep';
import Header from '../layout/Header';

jest.mock('../../supabaseClient', () => ({
  deleteMessage: jest.fn(),
}));

let triggerIntersection;

beforeEach(() => {
  triggerIntersection = null;
  global.IntersectionObserver = class IntersectionObserver {
    constructor(callback) {
      triggerIntersection = callback;
    }

    observe() {}

    disconnect() {}
  };
});

afterEach(() => {
  delete global.IntersectionObserver;
});

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

const SocialHarness = (props) => {
  const [feedSort, setFeedSort] = useState(props.defaultFeed || 'for_you');
  return (
    <>
      <Header
        connectedAddress={props.address}
        displayName="reader"
        onDisconnect={jest.fn()}
        onHome={jest.fn()}
        showNetworkNavigation
        networkMode="classic"
        feedSort={feedSort}
        onFeedSortChange={setFeedSort}
      />
      <SocialStep {...props} activeMode="classic" feedSort={feedSort} />
    </>
  );
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

  return { ...render(<SocialHarness {...props} />), onLoadMessages: props.onLoadMessages };
};

test('opens the personalized feed by default and keeps Latest and Followed available', async () => {
  const { onLoadMessages } = renderSocialStep();

  await waitFor(() => {
    expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'for_you', null);
  });
  expect(screen.getByRole('button', { name: /for you/i })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: /latest/i }));
  await waitFor(() => expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'recent', null));

  fireEvent.click(screen.getByRole('button', { name: /followed/i }));
  await waitFor(() => expect(onLoadMessages).toHaveBeenCalledWith(20, 0, 'followed', null));

  fireEvent.click(screen.getByRole('button', { name: /for you/i }));
  expect(onLoadMessages).toHaveBeenCalledTimes(3);
});

test('shows the signed-in profile photo beside the post composer', async () => {
  renderSocialStep({ avatarUrl: 'https://media.example/avatar.webp' });

  expect(await screen.findByRole('img', { name: /your profile/i }))
    .toHaveAttribute('src', 'https://media.example/avatar.webp');
});

test('loads the next page from its opaque cursor and removes duplicate posts', async () => {
  const secondMessage = {
    ...message,
    id: 'message-2',
    content: 'A second stable page.',
  };
  const onLoadMessages = jest.fn()
    .mockResolvedValueOnce({ messages: [message], hasMore: true, nextCursor: 'cursor-1' })
    .mockResolvedValueOnce({ messages: [message, secondMessage], hasMore: false, nextCursor: null });

  renderSocialStep({ onLoadMessages });
  expect(await screen.findByText(message.content)).toBeInTheDocument();

  await waitFor(() => expect(triggerIntersection).toEqual(expect.any(Function)));
  act(() => triggerIntersection([{ isIntersecting: true }]));

  await waitFor(() => {
    expect(onLoadMessages).toHaveBeenLastCalledWith(20, 1, 'for_you', 'cursor-1');
  });
  expect(await screen.findByText(secondMessage.content)).toBeInTheDocument();
  expect(screen.getAllByText(message.content)).toHaveLength(1);
  expect(screen.queryByTestId('feed-load-sentinel')).not.toBeInTheDocument();
});

test('ignores a late response from a feed tab that is no longer active', async () => {
  let resolveForYou;
  const forYouRequest = new Promise((resolve) => {
    resolveForYou = resolve;
  });
  const latestMessage = {
    ...message,
    id: 'latest-message',
    content: 'The current Latest result.',
  };
  const onLoadMessages = jest.fn()
    .mockReturnValueOnce(forYouRequest)
    .mockResolvedValueOnce({ messages: [latestMessage], hasMore: false, nextCursor: null });

  renderSocialStep({ onLoadMessages });
  fireEvent.click(screen.getByRole('button', { name: /latest/i }));

  expect(await screen.findByText(latestMessage.content)).toBeInTheDocument();
  resolveForYou({ messages: [message], hasMore: false, nextCursor: null });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /latest/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(message.content)).not.toBeInTheDocument();
  });
});

test('adds a newly published post locally without loading the feed again', async () => {
  const publishedMessage = {
    ...message,
    id: 'message-published',
    bitcoin_address: 'bc1q-reader',
    content: 'My locally inserted post.',
  };
  const onPublishMessage = jest.fn().mockResolvedValue({
    success: true,
    message: publishedMessage,
  });
  const { onLoadMessages } = renderSocialStep({
    defaultFeed: 'recent',
    onPublishMessage,
  });

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/share something new/i), {
    target: { value: publishedMessage.content },
  });
  const publishButton = screen.getAllByRole('button', { name: /^publish$/i })
    .find((button) => !button.disabled);
  fireEvent.click(publishButton);

  expect(await screen.findByText(publishedMessage.content)).toBeInTheDocument();
  expect(onPublishMessage).toHaveBeenCalledWith(publishedMessage.content);
  expect(onLoadMessages).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/^your post is published$/i)).toBeInTheDocument();
});

test('hydrates a locally added repost with the signed-in name and profile photo', async () => {
  const publishedRepost = {
    id: 'repost-published',
    content: '',
    created_at: new Date().toISOString(),
    repost_of: message.id,
    repost_kind: 'repost',
  };
  const onRepostMessage = jest.fn().mockResolvedValue({
    active: true,
    reposts_count: 1,
    message: publishedRepost,
  });
  const { container } = renderSocialStep({
    defaultFeed: 'recent',
    displayName: 'reader',
    avatarUrl: 'https://media.example/reader.webp',
    onRepostMessage,
  });

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(/^repost$/i));
  fireEvent.click(await screen.findByRole('button', { name: /^repost$/i }));

  expect(await screen.findByText('@reader')).toBeInTheDocument();
  expect(container.querySelector('img[src="https://media.example/reader.webp"]')).toBeInTheDocument();
  expect(onRepostMessage).toHaveBeenCalledWith(message.id, '');
});

test('opens and focuses the comment composer without loading comments inline', async () => {
  const publishedComment = {
    ...message,
    id: 'comment-published',
    bitcoin_address: 'bc1q-reader',
    content: 'A local comment.',
    parent_id: message.id,
  };
  const onPublishMessage = jest.fn().mockResolvedValue({
    success: true,
    message: publishedComment,
  });
  const { onLoadMessages } = renderSocialStep({ onPublishMessage });

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /write a comment/i }));
  const commentInput = await screen.findByPlaceholderText(/write your comment/i);
  expect(commentInput).toHaveFocus();
  fireEvent.change(commentInput, {
    target: { value: publishedComment.content },
  });
  const commentPublishButton = screen.getAllByRole('button', { name: /^publish$/i })
    .find((button) => !button.disabled);
  fireEvent.click(commentPublishButton);

  await waitFor(() => {
    expect(onPublishMessage).toHaveBeenCalledWith(publishedComment.content, message.id);
  });
  await waitFor(() => {
    expect(screen.queryByPlaceholderText(/write your comment/i)).not.toBeInTheDocument();
  });
  expect(screen.queryByRole('article', { name: publishedComment.content })).not.toBeInTheDocument();
  expect(onLoadMessages).toHaveBeenCalledTimes(1);
});

test('temporarily hides a recommendation and lets the reader undo it', async () => {
  const onForYouNotInterested = jest.fn().mockResolvedValue({ success: true });
  renderSocialStep({ onForYouNotInterested });

  expect(await screen.findByText('A post selected for this reader.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /not interested/i }));

  expect(await screen.findByText(/post hidden/i)).toBeInTheDocument();
  expect(screen.queryByText('A post selected for this reader.')).not.toBeInTheDocument();
  expect(onForYouNotInterested).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /undo/i }));
  expect(await screen.findByText('A post selected for this reader.')).toBeInTheDocument();
  expect(onForYouNotInterested).not.toHaveBeenCalled();
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

test('reduces an author without removing the current post', async () => {
  const onEditorialPreference = jest.fn().mockResolvedValue({ success: true });
  renderSocialStep({ onEditorialPreference });

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /show less from this author/i }));

  await waitFor(() => {
    expect(onEditorialPreference).toHaveBeenCalledWith('bc1q-author', 'reduce');
  });
  expect(screen.getByText(message.content)).toBeInTheDocument();
  expect(await screen.findByText(/fewer posts from this author/i)).toBeInTheDocument();
});

test('records a private topic reduction from the post options menu', async () => {
  const onEditorialTopicPreference = jest.fn().mockResolvedValue({ success: true });
  renderSocialStep({
    onEditorialTopicPreference,
    onLoadMessages: jest.fn().mockResolvedValue([{ ...message, topic_feedback_available: true }]),
  });

  expect(await screen.findByText(message.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /post options/i }));
  fireEvent.click(screen.getByRole('button', { name: /show less from this topic/i }));

  await waitFor(() => {
    expect(onEditorialTopicPreference).toHaveBeenCalledWith('message-1', 'reduce');
  });
  expect(await screen.findByText(/fewer posts related to this topic/i)).toBeInTheDocument();
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
