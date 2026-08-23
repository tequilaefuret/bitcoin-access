import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RepostComposer from './RepostComposer';
import { optimizePostImages, releasePostImage } from '../../lib/postMedia';

jest.mock('../../lib/postMedia', () => ({
  formatImageBytes: (bytes) => `${Math.ceil(bytes / 1024)} KB`,
  MAX_POST_IMAGES: 3,
  optimizePostImages: jest.fn(),
  postImageShellCost: (bytes) => Math.ceil(bytes / 1024),
  releasePostImage: jest.fn(),
}));

const optimizedFile = new File(['optimized'], 'quote.webp', { type: 'image/webp' });
const optimizedPhoto = {
  id: 'optimized-photo',
  file: optimizedFile,
  previewUrl: 'blob:quote-preview',
  optimizedBytes: 361472,
};

beforeEach(() => {
  jest.clearAllMocks();
  optimizePostImages.mockResolvedValue([optimizedPhoto]);
});

test('optimizes and submits a photo with a quoted repost', async () => {
  const onSubmit = jest.fn().mockResolvedValue({ success: true });
  const { container } = render(
    <RepostComposer
      showOptions={false}
      showQuoteComposer
      userHasReposted={false}
      repostedCharacterCount={10}
      quoteText="Context"
      onQuoteTextChange={jest.fn()}
      repostLoading={false}
      onSubmit={onSubmit}
      onCloseQuote={jest.fn()}
    />
  );

  const sourcePhoto = new File(['source'], 'camera.jpg', { type: 'image/jpeg' });
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [sourcePhoto] },
  });

  expect(await screen.findByRole('img', { name: /selected quote attachment 1/i })).toBeInTheDocument();
  expect(optimizePostImages).toHaveBeenCalledWith([sourcePhoto], 0);
  expect(screen.getByText('7 / 1000 · 370 shells')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /publish quote/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Context', [optimizedFile]));
  expect(releasePostImage.mock.calls[0][0]).toBe(optimizedPhoto);
});

test('allows an image-only quoted repost and releases its preview on cancel', async () => {
  const onSubmit = jest.fn().mockResolvedValue({ success: true });
  const onCloseQuote = jest.fn();
  const { container } = render(
    <RepostComposer
      showOptions={false}
      showQuoteComposer
      userHasReposted={false}
      repostedCharacterCount={10}
      quoteText=""
      onQuoteTextChange={jest.fn()}
      repostLoading={false}
      onSubmit={onSubmit}
      onCloseQuote={onCloseQuote}
    />
  );

  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [new File(['source'], 'camera.jpg', { type: 'image/jpeg' })] },
  });
  await screen.findByRole('img', { name: /selected quote attachment 1/i });
  expect(screen.getByRole('button', { name: /publish quote/i })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: /close quoted repost composer/i }));
  expect(releasePostImage.mock.calls[0][0]).toBe(optimizedPhoto);
  expect(onCloseQuote).toHaveBeenCalledTimes(1);
});
