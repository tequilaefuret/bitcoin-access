import React, { useEffect, useRef } from 'react';
import { Compass, ImagePlus, Loader, Send, X } from 'lucide-react';
import { FeedSkeleton } from '../ui/ContentSkeletons';
import { formatImageBytes, MAX_POST_IMAGES } from '../../lib/postMedia';

const emptyFeedMessage = (sortMode) => {
  if (sortMode === 'followed') return 'Follow people from their profile to start building this feed.';
  if (sortMode === 'for_you') return 'Interact with posts or follow people to shape your recommendations.';
  return 'No posts yet. Start the conversation.';
};

const ClassicFeedPanel = ({
  messageContent,
  onMessageContentChange,
  onPublish,
  isPublishing,
  actionLoading,
  classicSort,
  isLoadingFeed,
  messages,
  renderMessage,
  hasMore,
  onLoadMore,
  isLoadingMore,
  avatarUrl = '',
  photos = [],
  onPhotosSelected,
  onRemovePhoto,
  isOptimizingPhotos = false,
}) => {
  const charCount = messageContent.replace(/\n/g, '').length;
  const loadMoreSentinelRef = useRef(null);
  const photoInputRef = useRef(null);
  const canPublish = Boolean(messageContent.trim() || photos.length > 0);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore || isLoadingFeed || isLoadingMore || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore?.();
    }, { rootMargin: '1200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingFeed, isLoadingMore, onLoadMore]);

  return (
    <div className="mx-auto max-w-[720px]">
      <main className="min-w-0 space-y-4">
        <section className="overflow-hidden rounded-[1.6rem] border border-white/[0.09] bg-[#11131a] shadow-[0_22px_60px_-34px_rgba(0,0,0,0.9)]">
          <div className="flex gap-3 p-4 sm:p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-sm font-black text-slate-950">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Your profile" className="h-full w-full object-cover" />
              ) : 'Y'}
            </span>
            <div className="min-w-0 flex-1">
              <textarea
                value={messageContent}
                onChange={(event) => onMessageContentChange(event.target.value)}
                placeholder="Share something new..."
                maxLength={1000}
                rows={3}
                className="w-full resize-none bg-transparent pt-2 text-base leading-7 text-white outline-none placeholder:text-white/25 sm:text-lg"
              />
              {photos.length > 0 && (
                <div className={`mt-3 grid gap-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}>
                  {photos.map((photo, index) => (
                    <div key={photo.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                      <img src={photo.previewUrl} alt={`Selected attachment ${index + 1}`} className="h-32 w-full object-cover sm:h-36" />
                      <button
                        type="button"
                        onClick={() => onRemovePhoto?.(photo.id)}
                        disabled={isPublishing}
                        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/75 text-white transition hover:bg-black disabled:opacity-50"
                        aria-label={`Remove photo ${index + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white/75">
                        {formatImageBytes(photo.optimizedBytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    ref={photoInputRef}
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
                    onClick={() => photoInputRef.current?.click()}
                    disabled={isPublishing || isOptimizingPhotos || photos.length >= MAX_POST_IMAGES}
                    className="inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Add photos"
                  >
                    {isOptimizingPhotos ? <Loader className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    <span>{isOptimizingPhotos ? 'Optimizing…' : `${photos.length}/${MAX_POST_IMAGES}`}</span>
                  </button>
                  <span className={`whitespace-nowrap text-xs font-medium ${charCount > 900 ? 'text-amber-300' : 'text-white/30'}`}>{charCount} / 1000</span>
                </div>
                <button type="button" onClick={onPublish} disabled={isPublishing || actionLoading || isOptimizingPhotos || !canPublish} className="inline-flex items-center gap-2 rounded-full bg-amber-300 px-5 py-2.5 text-sm font-extrabold text-slate-950 transition hover:-translate-y-0.5 hover:bg-amber-200 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40">
                  {isPublishing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="pt-1">
          {isLoadingFeed ? (
            <FeedSkeleton count={3} className="mt-4" />
          ) : messages.length > 0 ? (
            <div className="mt-4 space-y-3">{messages.map(renderMessage)}</div>
          ) : (
            <div className="mt-4 rounded-[1.6rem] border border-dashed border-white/10 bg-white/[0.025] px-6 py-16 text-center">
              <Compass className="mx-auto h-7 w-7 text-white/20" />
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/40">{emptyFeedMessage(classicSort)}</p>
            </div>
          )}

          {isLoadingMore && messages.length > 0 && <FeedSkeleton count={2} compact className="mt-3" />}
          {hasMore && messages.length > 0 && <div ref={loadMoreSentinelRef} data-testid="feed-load-sentinel" className="h-px" aria-hidden="true" />}
        </section>
      </main>

    </div>
  );
};

export default ClassicFeedPanel;
