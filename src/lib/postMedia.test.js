import {
  MAX_POST_IMAGE_EDGE,
  optimizePostImage,
  postImageShellCost,
  validatePostImageSelection,
} from './postMedia';

describe('post photo optimization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.createImageBitmap;
    delete URL.createObjectURL;
  });

  test('rejects more than three photos before decoding them', () => {
    const files = Array.from({ length: 4 }, (_, index) => (
      new File(['photo'], `photo-${index}.jpg`, { type: 'image/jpeg' })
    ));
    expect(() => validatePostImageSelection(files)).toThrow(/up to 3 photos/i);
  });

  test('resizes a large camera photo and re-encodes it as a small WebP', async () => {
    const close = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 4000,
      height: 3000,
      close,
    });
    URL.createObjectURL = jest.fn().mockReturnValue('blob:optimized');

    const canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn().mockReturnValue({
        fillStyle: '',
        fillRect: jest.fn(),
        drawImage: jest.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: '',
      }),
      toBlob: (callback, type) => callback(new Blob([
        new Uint8Array(400 * 1024),
      ], { type })),
    };
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
      tagName === 'canvas' ? canvas : createElement(tagName, options)
    ));

    const original = new File([
      new Uint8Array(5 * 1024 * 1024),
    ], 'holiday.jpg', { type: 'image/jpeg' });
    const optimized = await optimizePostImage(original);

    expect(global.createImageBitmap).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' });
    expect(optimized.file.type).toBe('image/webp');
    expect(optimized.file.size).toBe(400 * 1024);
    expect(optimized.width).toBe(MAX_POST_IMAGE_EDGE);
    expect(optimized.height).toBe(1200);
    expect(close).toHaveBeenCalled();
  });
});

describe('post photo shell billing', () => {
  test('charges one shell per started KiB', () => {
    expect(postImageShellCost(0)).toBe(0);
    expect(postImageShellCost(1)).toBe(1);
    expect(postImageShellCost(1024)).toBe(1);
    expect(postImageShellCost(1025)).toBe(2);
    expect(postImageShellCost(353 * 1024)).toBe(353);
  });
});
