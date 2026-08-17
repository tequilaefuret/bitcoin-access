import React from 'react';
import { Compass, Loader, Send } from 'lucide-react';
import { FeedSkeleton } from '../ui/ContentSkeletons';

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
}) => {
  const charCount = messageContent.replace(/\n/g, '').length;

  return (
    <div className="mx-auto max-w-[720px]">
      <main className="min-w-0 space-y-4">
        <section className="overflow-hidden rounded-[1.6rem] border border-white/[0.09] bg-[#11131a] shadow-[0_22px_60px_-34px_rgba(0,0,0,0.9)]">
          <div className="flex gap-3 p-4 sm:p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-sm font-black text-slate-950">Y</span>
            <div className="min-w-0 flex-1">
              <textarea
                value={messageContent}
                onChange={(event) => onMessageContentChange(event.target.value)}
                placeholder="Share something worth reading..."
                maxLength={1000}
                rows={3}
                className="w-full resize-none bg-transparent pt-2 text-base leading-7 text-white outline-none placeholder:text-white/25 sm:text-lg"
              />
              <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-3">
                <span className={`text-xs font-medium ${charCount > 900 ? 'text-amber-300' : 'text-white/30'}`}>{charCount} / 1000</span>
                <button type="button" onClick={onPublish} disabled={isPublishing || actionLoading || !messageContent.trim()} className="inline-flex items-center gap-2 rounded-full bg-amber-300 px-5 py-2.5 text-sm font-extrabold text-slate-950 transition hover:-translate-y-0.5 hover:bg-amber-200 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40">
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
          {hasMore && messages.length > 0 && !isLoadingMore && (
            <button type="button" onClick={onLoadMore} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] py-3 text-sm font-semibold text-white/55 transition hover:border-white/15 hover:bg-white/[0.06] hover:text-white">Load more</button>
          )}
        </section>
      </main>

    </div>
  );
};

export default ClassicFeedPanel;
