import React, { useState } from 'react';
import { Loader, Quote, Repeat2, X } from 'lucide-react';
import { postImageShellCost } from '../../lib/postMedia';
import useMessagePhotos from '../../hooks/useMessagePhotos';
import {
  MessagePhotoPickerButton,
  MessagePhotoPreviews,
} from './MessagePhotoAttachments';

const RepostComposer = ({
  showOptions,
  showQuoteComposer,
  userHasReposted,
  repostedCharacterCount,
  quoteText,
  onQuoteTextChange,
  repostLoading,
  onSubmit,
  onOpenQuote,
  onCloseQuote,
}) => {
  const [submitError, setSubmitError] = useState('');
  const {
    photos,
    isOptimizingPhotos,
    photoError,
    selectPhotos,
    removePhoto,
    clearPhotos,
  } = useMessagePhotos();
  const quoteCharacterCount = quoteText.trim().replace(/\n/g, '').length;
  const photoCost = photos.reduce((total, photo) => total + postImageShellCost(photo.optimizedBytes), 0);
  const canPublishQuote = Boolean(quoteText.trim() || photos.length > 0);

  const submitQuote = async () => {
    if (!onSubmit || !canPublishQuote || repostLoading || isOptimizingPhotos) return;
    setSubmitError('');
    try {
      const result = await onSubmit(
        quoteText.trim(),
        photos.map((photo) => photo.file),
      );
      if (!result || result.success === false) return;
      clearPhotos();
    } catch (submitError) {
      setSubmitError(submitError.message || 'The quoted repost could not be published.');
    }
  };

  const closeQuote = () => {
    clearPhotos();
    setSubmitError('');
    onCloseQuote?.();
  };

  return (
    <div onClick={(event) => event.stopPropagation()}>
    {showOptions && (
      <div className="mt-3 flex w-fit overflow-hidden rounded-xl border border-white/10 bg-[#191b22] shadow-lg">
        <button
          type="button"
          onClick={() => onSubmit('')}
          disabled={repostLoading}
          aria-label={userHasReposted ? 'Undo repost' : 'Repost'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.06] disabled:opacity-50"
        >
          <Repeat2 className="h-4 w-4" />
          {userHasReposted ? 'Undo repost' : 'Repost'}
          {!userHasReposted && (
            <span aria-hidden="true" className="text-xs font-normal text-white/30">
              {repostedCharacterCount} shells
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenQuote}
          className="inline-flex items-center gap-2 border-l border-white/10 px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.06]"
        >
          <Quote className="h-4 w-4" />
          Quote
        </button>
      </div>
    )}

    {showQuoteComposer && (
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-white/35">Add a comment</span>
          <button type="button" onClick={closeQuote} className="text-white/30 hover:text-white" aria-label="Close quoted repost composer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={quoteText}
          onChange={(event) => onQuoteTextChange(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Why are you sharing this?"
          disabled={repostLoading}
          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-300/50"
        />

        <MessagePhotoPreviews
          photos={photos}
          onRemovePhoto={removePhoto}
          disabled={repostLoading}
          contextLabel="quote"
        />

        {(submitError || photoError) && <p className="mt-2 text-xs text-red-300">{submitError || photoError}</p>}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessagePhotoPickerButton
              photos={photos}
              onPhotosSelected={selectPhotos}
              isOptimizing={isOptimizingPhotos}
              disabled={repostLoading}
              contextLabel="quoted repost"
            />
            <span className="whitespace-nowrap text-xs text-white/30">
              {quoteText.length} / 1000 · {repostedCharacterCount + quoteCharacterCount + photoCost} shells
            </span>
          </div>
          <button
            type="button"
            onClick={submitQuote}
            disabled={!canPublishQuote || repostLoading || isOptimizingPhotos}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
          >
            {repostLoading && <Loader className="h-3.5 w-3.5 animate-spin" />}
            Publish quote
          </button>
        </div>
      </div>
    )}
    </div>
  );
};

export default RepostComposer;
