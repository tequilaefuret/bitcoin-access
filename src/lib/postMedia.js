export const MAX_POST_IMAGES = 3;
export const MAX_POST_IMAGE_EDGE = 1600;
export const TARGET_POST_IMAGE_BYTES = 450 * 1024;
export const MAX_POST_IMAGE_BYTES = 600 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;

export const postImageShellCost = (bytes) => (
  Number.isFinite(bytes) && bytes > 0 ? Math.ceil(bytes / 1024) : 0
);

const ACCEPTED_SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('This browser could not compress the photo.'));
  }, type, quality);
});

const loadImage = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      // Safari versions without the imageOrientation option use the fallback.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The selected photo could not be read.'));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const outputName = (name, extension) => {
  const base = (name || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'photo';
  return `${base}.${extension}`;
};

export const formatImageBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${postImageShellCost(bytes)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const validatePostImageSelection = (files, existingCount = 0) => {
  const selected = Array.from(files || []);
  if (selected.length + existingCount > MAX_POST_IMAGES) {
    throw new Error(`You can add up to ${MAX_POST_IMAGES} photos to a message.`);
  }
  selected.forEach((file) => {
    if (!(file instanceof File) || !ACCEPTED_SOURCE_TYPES.has(file.type)) {
      throw new Error('Choose JPG, PNG or WebP photos.');
    }
    if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error('Each original photo must be smaller than 20 MB.');
    }
  });
  return selected;
};

export async function optimizePostImage(file) {
  validatePostImageSelection([file]);
  const loaded = await loadImage(file);

  try {
    if (!loaded.width || !loaded.height) throw new Error('The selected photo has invalid dimensions.');
    const initialScale = Math.min(1, MAX_POST_IMAGE_EDGE / Math.max(loaded.width, loaded.height));
    let width = Math.max(1, Math.round(loaded.width * initialScale));
    let height = Math.max(1, Math.round(loaded.height * initialScale));
    let quality = 0.62;
    let result = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('This browser cannot optimize photos.');
      context.fillStyle = '#11131a';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.source, 0, 0, width, height);

      result = await canvasToBlob(canvas, 'image/webp', quality);
      if (result.type !== 'image/webp') {
        result = await canvasToBlob(canvas, 'image/jpeg', quality);
      }
      if (result.size <= TARGET_POST_IMAGE_BYTES) break;

      if (quality > 0.44) {
        quality = Math.max(0.44, quality - 0.09);
      } else {
        const shrink = Math.min(0.88, Math.sqrt(TARGET_POST_IMAGE_BYTES / result.size) * 0.96);
        const minimumScale = Math.min(1, 480 / Math.max(width, height));
        const resizeScale = Math.max(minimumScale, shrink);
        width = Math.max(1, Math.round(width * resizeScale));
        height = Math.max(1, Math.round(height * resizeScale));
        if (Math.max(width, height) > MAX_POST_IMAGE_EDGE) {
          const edgeScale = MAX_POST_IMAGE_EDGE / Math.max(width, height);
          width = Math.round(width * edgeScale);
          height = Math.round(height * edgeScale);
        }
        quality = 0.52;
      }
    }

    if (!result || result.size > MAX_POST_IMAGE_BYTES) {
      throw new Error('This photo could not be reduced enough. Try a simpler or smaller image.');
    }

    const extension = result.type === 'image/webp' ? 'webp' : 'jpg';
    const optimizedFile = new File([result], outputName(file.name, extension), {
      type: result.type,
      lastModified: Date.now(),
    });
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file: optimizedFile,
      previewUrl: URL.createObjectURL(optimizedFile),
      width,
      height,
      originalBytes: file.size,
      optimizedBytes: optimizedFile.size,
    };
  } finally {
    loaded.close();
  }
}

export async function optimizePostImages(files, existingCount = 0) {
  const selected = validatePostImageSelection(files, existingCount);
  const optimized = [];
  try {
    // Process sequentially to avoid holding several full-resolution camera
    // photos in memory at once on mobile devices.
    for (const file of selected) optimized.push(await optimizePostImage(file));
    return optimized;
  } catch (error) {
    optimized.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    throw error;
  }
}

export const releasePostImage = (photo) => {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
};
