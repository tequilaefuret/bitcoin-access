import React, { useEffect, useRef, useState } from 'react';
import { Loader, Send } from 'lucide-react';
import useMessagePhotos from '../../hooks/useMessagePhotos';
import {
  MessagePhotoPickerButton,
  MessagePhotoPreviews,
} from './MessagePhotoAttachments';

const CommentComposer = ({
  onSubmit,
  onCancel,
  disabled = false,
  autoFocus = true,
  submitLabel = 'Publish',
  compact = false,
}) => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const inputRef = useRef(null);
  const {
    photos,
    isOptimizingPhotos,
    photoError,
    selectPhotos,
    removePhoto,
    clearPhotos,
  } = useMessagePhotos();
  const characterCount = content.replace(/\n/g, '').length;
  const canSubmit = Boolean(content.trim() || photos.length > 0);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    if (!onSubmit || !canSubmit || disabled || isOptimizingPhotos || isSubmitting) return;
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const result = await onSubmit(
        content.trim(),
        photos.map((photo) => photo.file),
      );
      if (!result || result.success === false) return;

      clearPhotos();
      setContent('');
    } catch (submitError) {
      setSubmitError(submitError.message || 'The comment could not be published.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div role="form" aria-label="Comment composer" className={`rounded-2xl border border-white/[0.08] bg-white/[0.035] ${compact ? 'p-2.5' : 'p-3'}`}>
      <textarea
        ref={inputRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Write your comment..."
        maxLength={1000}
        rows={compact ? 2 : 3}
        disabled={disabled || isSubmitting}
        className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-300/50 focus:ring-2 focus:ring-amber-300/10 disabled:opacity-50"
      />

      <MessagePhotoPreviews
        photos={photos}
        onRemovePhoto={removePhoto}
        disabled={disabled || isSubmitting}
        contextLabel="comment"
      />

      {(submitError || photoError) && <p className="mt-2 text-xs text-red-300">{submitError || photoError}</p>}

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessagePhotoPickerButton
            photos={photos}
            onPhotosSelected={selectPhotos}
            isOptimizing={isOptimizingPhotos}
            disabled={disabled || isSubmitting}
            contextLabel="comment"
          />
          <span className={`whitespace-nowrap text-xs ${characterCount > 900 ? 'text-amber-300' : 'text-white/30'}`}>
            {characterCount} / 1000
          </span>
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={disabled || isSubmitting || isOptimizingPhotos} className="px-2 py-1.5 text-sm text-white/45 hover:text-white disabled:opacity-40">
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || isSubmitting || isOptimizingPhotos || !canSubmit}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-4 py-1.5 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSubmitting ? 'Publishing…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommentComposer;
