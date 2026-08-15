import React from 'react';
import { Clock3, Loader, Send, Sparkles, Users } from 'lucide-react';
import { FeedSkeleton } from '../ui/ContentSkeletons';

const SORT_OPTIONS = [
  { id: 'for_you', label: 'For you', icon: Sparkles },
  { id: 'recent', label: 'Latest', icon: Clock3 },
  { id: 'followed', label: 'Followed', icon: Users },
];

const feedTitle = (sortMode) => {
  if (sortMode === 'for_you') return 'Selected for you';
  if (sortMode === 'followed') return 'Posts from people you follow';
  return 'Posts from the network';
};

const emptyFeedMessage = (sortMode) => {
  if (sortMode === 'followed') return 'Follow users from their profile to build this feed.';
  if (sortMode === 'for_you') {
    return 'Interact with posts or follow people to shape your recommendations.';
  }
  return 'No posts yet.';
};

const ClassicFeedPanel = ({
  messageContent,
  onMessageContentChange,
  onPublish,
  isPublishing,
  actionLoading,
  classicSort,
  onSortChange,
  isLoadingFeed,
  messages,
  renderMessage,
  hasMore,
  onLoadMore,
  isLoadingMore,
}) => {
  const charCount = messageContent.replace(/\n/g, '').length;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <main className="min-w-0 space-y-5">
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
          <textarea
            value={messageContent}
            onChange={(event) => onMessageContentChange(event.target.value)}
            placeholder="Share something worth reading..."
            maxLength={1000}
            rows={4}
            className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:bg-white"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">{charCount} / 1000 characters</span>
            <button
              type="button"
              onClick={onPublish}
              disabled={isPublishing || actionLoading || !messageContent.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPublishing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publish
            </button>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Classic feed</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">{feedTitle(classicSort)}</h3>
            </div>
            <div className="flex rounded-full bg-slate-100 p-1">
              {SORT_OPTIONS.map((sort) => {
                const Icon = sort.icon;
                return (
                  <button
                    key={sort.id}
                    type="button"
                    onClick={() => onSortChange(sort.id)}
                    aria-pressed={classicSort === sort.id}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold sm:px-3 ${
                      classicSort === sort.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {sort.label}
                  </button>
                );
              })}
            </div>
          </div>

          {isLoadingFeed ? (
            <FeedSkeleton count={3} className="mt-5" />
          ) : messages.length > 0 ? (
            <div className="mt-5 space-y-5">{messages.map(renderMessage)}</div>
          ) : (
            <p className="py-12 text-center text-sm text-slate-500">
              {emptyFeedMessage(classicSort)}
            </p>
          )}

          {isLoadingMore && messages.length > 0 && (
            <FeedSkeleton count={2} compact className="mt-5" />
          )}

          {hasMore && messages.length > 0 && !isLoadingMore && (
            <button
              type="button"
              onClick={onLoadMore}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              Load more
            </button>
          )}
        </section>
      </main>

      <aside className="space-y-4">
        <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
          {classicSort === 'for_you' ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">Your signals</p>
              <h3 className="mt-2 text-xl font-black">Relevant, with room to discover.</h3>
              <p className="mt-3 text-sm leading-6 text-white/70">
                Follows, Useful marks, replies and reposts shape this feed. Fresh voices are blended in automatically.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">One signal</p>
              <h3 className="mt-2 text-xl font-black">Useful, not agreeable.</h3>
              <p className="mt-3 text-sm leading-6 text-white/70">
                Mark a post when it helps you understand. Useful posts can rise here and enter the Opinion candidate pool.
              </p>
              <p className="mt-3 text-xs font-semibold text-amber-300">
                Adding Useful costs 1 satoshi. Removing it is free.
              </p>
            </>
          )}
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
          Only a small, topic-relevant share of the Classic feed will be selected for Opinion.
        </div>
      </aside>
    </div>
  );
};

export default ClassicFeedPanel;
