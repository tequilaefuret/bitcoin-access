import React, { useEffect, useRef } from 'react';
import { Compass } from 'lucide-react';
import { FeedSkeleton } from '../ui/ContentSkeletons';
import PostComposer from './PostComposer';

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
  const loadMoreSentinelRef = useRef(null);

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
        <PostComposer
          messageContent={messageContent}
          onMessageContentChange={onMessageContentChange}
          onPublish={onPublish}
          isPublishing={isPublishing}
          actionLoading={actionLoading}
          avatarUrl={avatarUrl}
          photos={photos}
          onPhotosSelected={onPhotosSelected}
          onRemovePhoto={onRemovePhoto}
          isOptimizingPhotos={isOptimizingPhotos}
        />

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
