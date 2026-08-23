import React, { useRef } from 'react';
import { ImagePlus, Loader, X } from 'lucide-react';
import {
  formatImageBytes,
  MAX_POST_IMAGES,
  postImageShellCost,
} from '../../lib/postMedia';

export const MessagePhotoPreviews = ({
  photos = [],
  onRemovePhoto,
  disabled = false,
  contextLabel = '',
  large = false,
}) => {
  if (photos.length === 0) return null;

  return (
    <div className={`mt-2 grid gap-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {photos.map((photo, index) => (
        <div key={photo.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <img
            src={photo.previewUrl}
            alt={`Selected${contextLabel ? ` ${contextLabel}` : ''} attachment ${index + 1}`}
            className={`${large ? 'h-32 sm:h-36' : 'h-28'} w-full object-cover`}
          />
          <button
            type="button"
            onClick={() => onRemovePhoto?.(photo.id)}
            disabled={disabled}
            className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/75 text-white transition hover:bg-black disabled:opacity-50"
            aria-label={`Remove${contextLabel ? ` ${contextLabel}` : ''} photo ${index + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/75 px-2 py-1 text-[9px] font-semibold text-white/75">
            {formatImageBytes(photo.optimizedBytes)} · {postImageShellCost(photo.optimizedBytes)} shells
          </span>
        </div>
      ))}
    </div>
  );
};

export const MessagePhotoPickerButton = ({
  photos = [],
  onPhotosSelected,
  isOptimizing = false,
  disabled = false,
  contextLabel = '',
}) => {
  const inputRef = useRef(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => {
          onPhotosSelected?.(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isOptimizing || photos.length >= MAX_POST_IMAGES}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={contextLabel ? `Add photos to ${contextLabel}` : 'Add photos'}
      >
        {isOptimizing ? <Loader className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        <span>{isOptimizing ? 'Optimizing…' : `${photos.length}/${MAX_POST_IMAGES}`}</span>
      </button>
    </>
  );
};
