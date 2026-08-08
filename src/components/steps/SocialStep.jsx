import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Clock3,
  Flame,
  Loader,
  Lock,
  MessageSquareText,
  PenSquare,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  UserRound
} from 'lucide-react';
import MessageCard from '../social/MessageCard';
import ErrorAlert from '../ui/ErrorAlert';
import { deleteMessage } from '../../supabaseClient';

const PRIVATE_STANCES = [
  { id: 'for', label: 'For' },
  { id: 'against', label: 'Against' },
  { id: 'undecided', label: 'Undecided' },
  { id: 'learning', label: 'Still learning' }
];

const trendWindowLabel = (windowMinutes) => ({
  60: '1h',
  360: '6h',
  1440: '24h',
  10080: '7d'
}[Number(windowMinutes)] || null);

const TrendBadge = ({ topic, active = false }) => {
  const windowLabel = trendWindowLabel(topic.trend_window_minutes);
  const status = topic.trend_status || 'emerging';
  const label = status === 'hot'
    ? `Hot${windowLabel ? ` · ${windowLabel}` : ''}`
    : status === 'declining'
      ? `Cooling${windowLabel ? ` · ${windowLabel}` : ''}`
      : `Emerging${windowLabel ? ` · ${windowLabel}` : ''}`;
  const Icon = status === 'hot' ? Flame : status === 'declining' ? Clock3 : TrendingUp;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
      active
        ? 'bg-white/10 text-amber-200'
        : status === 'hot'
          ? 'bg-orange-100 text-orange-700'
          : status === 'declining'
            ? 'bg-slate-100 text-slate-500'
            : 'bg-emerald-100 text-emerald-700'
    }`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
};

const TopicCard = ({ topic, active, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`w-full rounded-2xl border p-4 text-left transition ${
      active
        ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-900/20'
        : 'border-slate-200 bg-white text-slate-950 hover:border-amber-300 hover:bg-amber-50/40'
    }`}
  >
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${active ? 'text-amber-300' : 'text-amber-700'}`}>
        {topic.category}
      </span>
      <div className="flex items-center gap-2">
        <TrendBadge topic={topic} active={active} />
        <span className={`flex items-center gap-1 text-xs ${active ? 'text-white/60' : 'text-slate-400'}`}>
          <MessageSquareText className="h-3.5 w-3.5" />
          {topic.posts?.length || 0}
        </span>
      </div>
    </div>
    <h3 className="mt-2 text-base font-black">{topic.title}</h3>
    <p className={`mt-2 text-sm leading-6 ${active ? 'text-white/70' : 'text-slate-600'}`}>
      {topic.question}
    </p>
  </button>
);

const SocialStep = ({
  address,
  onPublishMessage,
  onLoadMessages,
  onLoadComments,
  onToggleUseful,
  onRepostMessage,
  onLoadOpinionTopics,
  onSetPrivateStance,
  loading,
  error,
  onUserClick,
  onOpenOwnProfile,
  onOpenGame,
  onOpenCanvas,
  onShowHistory,
  onShowStats,
  onSync,
  followingAddresses = []
}) => {
  const [activeMode, setActiveMode] = useState('classic');
  const [classicSort, setClassicSort] = useState('recent');
  const [messageContent, setMessageContent] = useState('');
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingOpinion, setIsLoadingOpinion] = useState(false);
  const [isSavingStance, setIsSavingStance] = useState(false);
  const [screenError, setScreenError] = useState('');
  const loadedSessionRef = useRef('');

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) || topics[0] || null,
    [selectedTopicId, topics]
  );

  const nextTopics = useMemo(
    () => topics.filter((topic) => topic.id !== selectedTopic?.id).slice(0, 3),
    [selectedTopic, topics]
  );

  const loadClassicFeed = async (sortMode = classicSort) => {
    setIsLoadingFeed(true);
    setScreenError('');

    try {
      const loadedMessages = await onLoadMessages?.(20, 0, sortMode);
      const activeMessages = (loadedMessages || []).filter((message) => !message.deleted_at);
      setMessages(activeMessages);
      setHasMore(activeMessages.length === 20);
    } catch (loadError) {
      setScreenError(loadError.message || 'The feed could not be loaded.');
    } finally {
      setIsLoadingFeed(false);
    }
  };

  const loadOpinionFeed = async () => {
    setIsLoadingOpinion(true);
    setScreenError('');

    try {
      const loadedTopics = await onLoadOpinionTopics?.();

      setTopics(loadedTopics || []);
      setSelectedTopicId((current) => {
        if ((loadedTopics || []).some((topic) => topic.id === current)) return current;
        return loadedTopics?.[0]?.id || null;
      });
    } catch (loadError) {
      setScreenError(loadError.message || 'Opinion topics could not be loaded.');
    } finally {
      setIsLoadingOpinion(false);
    }
  };

  useEffect(() => {
    const sessionKey = address || 'anonymous';
    if (loadedSessionRef.current === sessionKey) return;
    loadedSessionRef.current = sessionKey;

    loadClassicFeed('recent');
    loadOpinionFeed();
    // Initial loading is deliberately keyed to the authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const updateMessageEverywhere = (messageId, updater) => {
    setMessages((current) => {
      const updated = current.map((message) => (
        message.id === messageId ? updater(message) : message
      ));

      return updated;
    });
    setTopics((current) => current.map((topic) => ({
      ...topic,
      posts: (topic.posts || []).map((post) => (
        post.id === messageId ? updater(post) : post
      ))
    })));
  };

  const handleUseful = async (messageId) => {
    const result = await onToggleUseful?.(messageId);
    if (result) {
      updateMessageEverywhere(messageId, (message) => ({
        ...message,
        useful_count: result.useful_count,
        user_has_marked_useful: result.active
      }));
    }
    return result;
  };

  const handlePublish = async () => {
    const content = messageContent.trim();
    if (!content || !onPublishMessage) return;

    const result = await onPublishMessage(content);
    if (!result || result.success === false) return;

    await loadClassicFeed(classicSort);

    setMessageContent('');
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const loadedMessages = await onLoadMessages?.(20, messages.length, classicSort);
      const activeMessages = (loadedMessages || []).filter((message) => !message.deleted_at);
      setMessages((current) => [...current, ...activeMessages]);
      setHasMore(activeMessages.length === 20);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleComment = async (messageId, commentText, onSuccess) => {
    const content = commentText.trim();
    if (!content || !onPublishMessage) return;

    const result = await onPublishMessage(content, messageId);

    if (!result || result.success === false) return;

    updateMessageEverywhere(messageId, (message) => ({
      ...message,
      comments_count: (Number(message.comments_count) || 0) + 1
    }));

    if (onSuccess) onSuccess(result.message || null);
  };

  const handleDelete = async (messageId) => {
    if (!window.confirm('Delete this post?')) return;

    await deleteMessage(address, messageId);

    setMessages((current) => current.filter((message) => message.id !== messageId));
    setTopics((current) => current.map((topic) => ({
      ...topic,
      posts: (topic.posts || []).filter((post) => post.id !== messageId)
    })));
  };

  const handleSortChange = async (sortMode) => {
    if (sortMode === classicSort) return;
    setClassicSort(sortMode);
    await loadClassicFeed(sortMode);
  };

  const handlePrivateStance = async (stance) => {
    if (!selectedTopic) return;

    const previousStance = selectedTopic.private_stance || 'undecided';
    setTopics((current) => current.map((topic) => (
      topic.id === selectedTopic.id ? { ...topic, private_stance: stance } : topic
    )));
    setIsSavingStance(true);
    setScreenError('');

    try {
      await onSetPrivateStance?.(selectedTopic.id, stance);
    } catch (stanceError) {
      setTopics((current) => current.map((topic) => (
        topic.id === selectedTopic.id ? { ...topic, private_stance: previousStance } : topic
      )));
      setScreenError(stanceError.message || 'Your private position could not be saved.');
    } finally {
      setIsSavingStance(false);
    }
  };

  const handleRepost = async (messageId, quoteContent = '') => {
    const result = await onRepostMessage?.(messageId, quoteContent);
    if (result) await loadClassicFeed(classicSort);
    return result;
  };
  const charCount = messageContent.replace(/\n/g, '').length;

  const renderMessage = (message) => (
    <MessageCard
      key={message.id}
      message={message}
      currentAddress={address}
      onUseful={handleUseful}
      onComment={handleComment}
      onLoadComments={onLoadComments}
      onRepost={handleRepost}
      onDelete={handleDelete}
      onUserClick={onUserClick}
      isFollowed={followingAddresses.includes(message.bitcoin_address)}
    />
  );

  return (
    <div className="mx-auto max-w-5xl">
      <ErrorAlert error={screenError || error} />

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.28),_transparent_38%),linear-gradient(135deg,_#ffffff_0%,_#f8fafc_100%)] p-6 shadow-xl shadow-slate-900/10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Danaus network</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              Scroll freely. Pause when it matters.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Classic keeps the open feed. Opinion selects a small set of useful posts around a shared question.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Profile', icon: UserRound, action: onOpenOwnProfile },
              { label: 'Insights', icon: BarChart3, action: onShowStats },
              { label: 'Game', icon: Sparkles, action: onOpenGame },
              { label: 'Canvas', icon: PenSquare, action: onOpenCanvas },
              { label: 'History', icon: BookOpen, action: onShowHistory },
              { label: 'Sync', icon: RefreshCw, action: onSync }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.action?.()}
                  disabled={!item.action}
                  title={item.label}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-amber-300 hover:text-slate-950 disabled:opacity-40"
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 inline-flex rounded-2xl bg-slate-100 p-1">
          {[
            { id: 'classic', label: 'Classic', icon: MessageSquareText },
            { id: 'opinion', label: 'Opinion', icon: Flame }
          ].map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveMode(mode.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                  activeMode === mode.id
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                <Icon className="h-4 w-4" />
                {mode.label}
              </button>
            );
          })}
        </div>
      </section>

      {activeMode === 'classic' ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <main className="min-w-0 space-y-5">
            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
              <textarea
                value={messageContent}
                onChange={(event) => setMessageContent(event.target.value)}
                placeholder="Share something worth reading..."
                maxLength={1000}
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:bg-white"
              />
              <div className="mt-3 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">{charCount} / 1000 characters</span>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={loading || !messageContent.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publish
                </button>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Classic feed</p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">
                    {classicSort === 'followed' ? 'Posts from people you follow' : 'Posts from the network'}
                  </h3>
                </div>
                <div className="flex rounded-full bg-slate-100 p-1">
                  {[
                    { id: 'recent', label: 'Latest', icon: Clock3 },
                    { id: 'followed', label: 'Followed', icon: Users }
                  ].map((sort) => {
                    const Icon = sort.icon;
                    return (
                      <button
                        key={sort.id}
                        type="button"
                        onClick={() => handleSortChange(sort.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
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
                <div className="flex justify-center py-12"><Loader className="h-6 w-6 animate-spin text-amber-500" /></div>
              ) : messages.length > 0 ? (
                <div className="mt-5 space-y-5">{messages.map(renderMessage)}</div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-500">
                  {classicSort === 'followed'
                    ? 'Follow users from their profile to build this feed.'
                    : 'No posts yet.'}
                </p>
              )}

              {hasMore && messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                >
                  {isLoadingMore && <Loader className="h-4 w-4 animate-spin" />}
                  Load more
                </button>
              )}
            </section>
          </main>

          <aside className="space-y-4">
            <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">One signal</p>
              <h3 className="mt-2 text-xl font-black">Useful, not agreeable.</h3>
              <p className="mt-3 text-sm leading-6 text-white/70">
                Mark a post when it helps you understand. Useful posts can rise here and enter the Opinion candidate pool.
              </p>
              <p className="mt-3 text-xs font-semibold text-amber-300">
                Adding Useful costs 1 satoshi. Removing it is free.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
              Only a small, topic-relevant share of the Classic feed will be selected for Opinion.
            </div>
          </aside>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside>
            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/50 lg:sticky lg:top-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Opinion topics</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">Choose a question</h3>
              <div className="mt-4 space-y-3">
                {topics.map((topic) => (
                  <TopicCard
                    key={topic.id}
                    topic={topic}
                    active={topic.id === selectedTopic?.id}
                    onSelect={() => setSelectedTopicId(topic.id)}
                  />
                ))}
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-6">
            {isLoadingOpinion ? (
              <div className="flex justify-center rounded-[1.75rem] border border-slate-200 bg-white py-20">
                <Loader className="h-7 w-7 animate-spin text-amber-500" />
              </div>
            ) : !selectedTopic ? (
              <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                No Opinion topics are active yet.
              </div>
            ) : (
              <>
                <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/50">
                  <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">{selectedTopic.category}</p>
                      <TrendBadge topic={selectedTopic} />
                    </div>
                    <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{selectedTopic.title}</h3>
                    <p className="mt-3 text-base font-medium leading-7 text-slate-700">{selectedTopic.question}</p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Posts are selected by topic relevance and usefulness, then shown without orientation labels.
                    </div>
                  </div>

                  <div className="p-6">
                    {(selectedTopic.posts || []).length > 0 ? (
                      <div className="space-y-5">{selectedTopic.posts.map(renderMessage)}</div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                        <p className="font-semibold text-slate-800">No real posts have been selected for this topic yet.</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          Useful posts from the Classic feed will enter this topic automatically once the model is confident enough.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/50">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        <Lock className="h-3.5 w-3.5" />
                        Private position
                      </div>
                      <h4 className="mt-2 text-2xl font-black text-slate-950">Where do you stand now?</h4>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Your choice stays private and never labels, classifies or ranks any post.
                      </p>
                    </div>
                    {isSavingStance && <Loader className="h-5 w-5 animate-spin text-amber-500" />}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {PRIVATE_STANCES.map((stance) => (
                      <button
                        key={stance.id}
                        type="button"
                        onClick={() => handlePrivateStance(stance.id)}
                        disabled={isSavingStance}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          selectedTopic.private_stance === stance.id
                            ? 'border-slate-950 bg-slate-950 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        {stance.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/50">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Next topics</p>
                  <div className="mt-4 space-y-3">
                    {nextTopics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => setSelectedTopicId(topic.id)}
                        className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50"
                      >
                        <div>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">{topic.category}</span>
                          <p className="mt-1 font-bold text-slate-950">{topic.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{topic.question}</p>
                        </div>
                        <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default SocialStep;
