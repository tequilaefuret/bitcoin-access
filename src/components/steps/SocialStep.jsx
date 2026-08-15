import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Flame,
  MessageSquareText,
  PenSquare,
  RefreshCw,
  Sparkles,
  UserRound
} from 'lucide-react';
import MessageCard from '../social/MessageCard';
import ClassicFeedPanel from '../social/ClassicFeedPanel';
import OpinionFeedPanel from '../social/OpinionFeedPanel';
import TemporarilyHiddenPost from '../social/TemporarilyHiddenPost';
import ErrorAlert from '../ui/ErrorAlert';
import { deleteMessage } from '../../supabaseClient';
import { normalizePublishedMessage } from '../../features/feed/classicFeedState';
import { useClassicFeed } from '../../features/feed/useClassicFeed';
import { useTemporaryMessageHides } from '../../features/feed/useTemporaryMessageHides';

const SocialStep = ({
  address,
  onPublishMessage,
  onLoadMessages,
  onLoadComments,
  onToggleUseful,
  onRepostMessage,
  onForYouNotInterested,
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
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
  followingAddresses = [],
  defaultFeed = 'for_you'
}) => {
  const [activeMode, setActiveMode] = useState('classic');
  const [messageContent, setMessageContent] = useState('');
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoadingOpinion, setIsLoadingOpinion] = useState(false);
  const [isSavingStance, setIsSavingStance] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [editorialNotice, setEditorialNotice] = useState('');
  const opinionSessionRef = useRef('');
  const {
    classicSort,
    messages,
    hasMore,
    isLoadingFeed,
    isLoadingMore,
    feedError,
    changeSort,
    loadMore,
    updateMessage: updateClassicMessage,
    removeMessage: removeClassicMessage,
    filterMessages: filterClassicMessages,
    prependLatest,
    removeForYouMessage,
    temporarilyHideForYouMessage,
    restoreForYouMessage,
  } = useClassicFeed({ address, defaultFeed, onLoadMessages });
  const {
    hideTemporarily: hideForYouTemporarily,
    undoHide: undoForYouHide,
  } = useTemporaryMessageHides({
    temporarilyHideMessage: temporarilyHideForYouMessage,
    removeMessage: removeForYouMessage,
    restoreMessage: restoreForYouMessage,
    persistHide: onForYouNotInterested,
    onError: setScreenError,
  });

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) || topics[0] || null,
    [selectedTopicId, topics]
  );

  const nextTopics = useMemo(
    () => topics.filter((topic) => topic.id !== selectedTopic?.id).slice(0, 3),
    [selectedTopic, topics]
  );

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
    if (opinionSessionRef.current === sessionKey) return;
    opinionSessionRef.current = sessionKey;
    loadOpinionFeed();
    // Opinion loading is deliberately keyed to the authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const updateMessageEverywhere = (messageId, updater) => {
    updateClassicMessage(messageId, updater);
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
    if (!content || !onPublishMessage || isPublishing) return;

    setIsPublishing(true);
    setScreenError('');
    try {
      const result = await onPublishMessage(content);
      if (!result || result.success === false) return;

      const publishedMessage = normalizePublishedMessage(result.message, address);
      prependLatest(publishedMessage, classicSort === 'recent');
      setMessageContent('');
      setEditorialNotice(
        classicSort === 'recent'
          ? 'Your post is published and has been added without moving your feed.'
          : 'Your post is published. Your current feed has stayed in place.'
      );
    } catch (publishError) {
      setScreenError(publishError.message || 'The post could not be published.');
    } finally {
      setIsPublishing(false);
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

    removeClassicMessage(messageId);
    setTopics((current) => current.map((topic) => ({
      ...topic,
      posts: (topic.posts || []).filter((post) => post.id !== messageId)
    })));
  };

  const handleSortChange = async (sortMode) => {
    setScreenError('');
    await changeSort(sortMode);
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
    if (!result) return result;

    updateMessageEverywhere(messageId, (message) => ({
      ...message,
      reposts_count: Number(result.reposts_count) || 0,
      ...(!quoteContent.trim() ? { user_has_reposted: Boolean(result.active) } : {}),
    }));

    const sourceMessage = messages.find((message) => message.id === messageId);
    const publishedRepost = normalizePublishedMessage(result.message, address);
    if (publishedRepost) {
      const locallyHydratedRepost = {
        ...publishedRepost,
        reposted_message: sourceMessage?.reposted_message || sourceMessage || null,
      };
      prependLatest(locallyHydratedRepost);
    }

    setEditorialNotice('Your repost was saved without reloading the feed.');
    return result;
  };

  const handleForYouNotInterested = (messageId) => {
    const hiddenMessage = messages.find((message) => message.id === messageId);
    if (!hiddenMessage) return;
    setScreenError('');
    hideForYouTemporarily(hiddenMessage, messages.indexOf(hiddenMessage));
  };

  const handleEditorialPreference = async (authorAddress, preference) => {
    if (!authorAddress || !onEditorialPreference) return null;
    setScreenError('');
    setEditorialNotice('');

    const result = await onEditorialPreference(authorAddress, preference);
    if (['mute', 'block'].includes(preference)) {
      const isFromAuthor = (message) => (
        message.bitcoin_address === authorAddress
        || message.reposted_message?.bitcoin_address === authorAddress
      );
      filterClassicMessages((message) => !isFromAuthor(message));
      setTopics((current) => current.map((topic) => ({
        ...topic,
        posts: (topic.posts || []).filter((post) => !isFromAuthor(post)),
      })));
    }

    const labels = {
      reduce: 'You will see fewer posts from this author.',
      mute: 'This author is now hidden from your feeds.',
      block: 'This account is now blocked.',
    };
    setEditorialNotice(labels[preference] || 'Your preference was updated.');
    return result;
  };

  const handleReportMessage = async (messageId) => {
    if (!onReportMessage) return null;
    setScreenError('');
    setEditorialNotice('');
    const result = await onReportMessage(messageId);
    setEditorialNotice(result?.created
      ? 'Report recorded. Thank you.'
      : 'You already reported this post.');
    return result;
  };

  const handleEditorialTopicPreference = async (messageId, preference) => {
    if (!onEditorialTopicPreference) return null;
    setScreenError('');
    setEditorialNotice('');
    const result = await onEditorialTopicPreference(messageId, preference);
    setEditorialNotice('You will see fewer posts related to this topic.');
    return result;
  };
  const renderMessage = (message) => (
    message.temporarily_hidden ? (
      <TemporarilyHiddenPost
        key={message.id}
        onUndo={() => undoForYouHide(message.id)}
      />
    ) : (
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
      onNotInterested={classicSort === 'for_you' && onForYouNotInterested
        ? handleForYouNotInterested
        : null}
      onEditorialPreference={onEditorialPreference ? handleEditorialPreference : null}
      onEditorialTopicPreference={onEditorialTopicPreference
        ? handleEditorialTopicPreference
        : null}
      onReportMessage={onReportMessage ? handleReportMessage : null}
      isFollowed={followingAddresses.includes(message.bitcoin_address)}
    />
    )
  );

  return (
    <div className="mx-auto max-w-5xl">
      <ErrorAlert error={screenError || feedError || error} />
      {editorialNotice && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {editorialNotice}
        </div>
      )}

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
        <ClassicFeedPanel
          messageContent={messageContent}
          onMessageContentChange={setMessageContent}
          onPublish={handlePublish}
          isPublishing={isPublishing}
          actionLoading={loading}
          classicSort={classicSort}
          onSortChange={handleSortChange}
          isLoadingFeed={isLoadingFeed}
          messages={messages}
          renderMessage={renderMessage}
          hasMore={hasMore}
          onLoadMore={loadMore}
          isLoadingMore={isLoadingMore}
        />
      ) : (
        <OpinionFeedPanel
          topics={topics}
          selectedTopic={selectedTopic}
          nextTopics={nextTopics}
          onSelectTopic={setSelectedTopicId}
          isLoading={isLoadingOpinion}
          renderMessage={renderMessage}
          isSavingStance={isSavingStance}
          onPrivateStance={handlePrivateStance}
        />
      )}
    </div>
  );
};

export default SocialStep;
