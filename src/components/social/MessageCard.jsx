import React, { useState } from 'react';
import {
  Ellipsis,
  Lightbulb,
  MessageCircle,
  Repeat2,
  Trash2
} from 'lucide-react';
import ExpandableText from './ExpandableText';
import PostOptionsMenu from './PostOptionsMenu';
import RepostComposer from './RepostComposer';
import { FeedSkeleton } from '../ui/ContentSkeletons';
import {
  countBillableCharacters,
  formatMessageTimestamp,
} from '../../features/social/messagePresentation';

const MessageCard = ({
  message,
  currentAddress,
  onUseful,
  onComment,
  onLoadComments,
  onRepost,
  onDelete,
  onUserClick,
  onNotInterested,
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
  onOpenThread,
  isFollowed = false,
  showActions = true
}) => {
  const [showComments, setShowComments] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [localUsefulCount, setLocalUsefulCount] = useState(Number(message.useful_count) || 0);
  const [localUserMarkedUseful, setLocalUserMarkedUseful] = useState(
    Boolean(message.user_has_marked_useful)
  );
  const [localCommentsCount, setLocalCommentsCount] = useState(message.comments_count || 0);
  const [usefulError, setUsefulError] = useState('');
  const [usefulLoading, setUsefulLoading] = useState(false);
  const [localRepostsCount, setLocalRepostsCount] = useState(Number(message.reposts_count) || 0);
  const [localUserReposted, setLocalUserReposted] = useState(Boolean(message.user_has_reposted));
  const [showRepostOptions, setShowRepostOptions] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [quoteText, setQuoteText] = useState('');
  const [repostLoading, setRepostLoading] = useState(false);
  const [repostError, setRepostError] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [showEditorialMenu, setShowEditorialMenu] = useState(false);
  const [editorialAction, setEditorialAction] = useState('');
  const [editorialError, setEditorialError] = useState('');

  const authorAddress = message.bitcoin_address || null;
  const isOwnMessage = authorAddress === currentAddress;
  const optionsLabel = message.parent_id ? 'Comment options' : 'Post options';

  const displayAddress = message.display_name ? `@${message.display_name}` : '@anonymous';
  const avatarLetter = (message.display_name || 'A').trim().charAt(0).toUpperCase();

  const handleUseful = async () => {
    if (!onUseful || isOwnMessage || usefulLoading) return;

    const previousActive = localUserMarkedUseful;
    const previousCount = localUsefulCount;
    const optimisticActive = !previousActive;

    setUsefulError('');
    setUsefulLoading(true);
    setLocalUserMarkedUseful(optimisticActive);
    setLocalUsefulCount(Math.max(0, previousCount + (optimisticActive ? 1 : -1)));

    try {
      const result = await onUseful(message.id);
      if (result) {
        setLocalUserMarkedUseful(Boolean(result.active));
        setLocalUsefulCount(Number(result.useful_count) || 0);
      }
    } catch (error) {
      setLocalUserMarkedUseful(previousActive);
      setLocalUsefulCount(previousCount);
      setUsefulError(error.message || 'Useful could not be saved.');
    } finally {
      setUsefulLoading(false);
    }
  };

  const loadComments = async () => {
    if (loadingComments || commentsLoaded || !onLoadComments) return;

    setLoadingComments(true);
    try {
      const loadedComments = await onLoadComments(message.id);
      setComments((current) => {
        const merged = [...current, ...(loadedComments || [])];
        const seen = new Set();
        return merged.filter((comment) => {
          if (!comment?.id || seen.has(comment.id)) return false;
          seen.add(comment.id);
          return true;
        });
      });
      setCommentsLoaded(true);
    } catch {
      // Keep comments created locally even if the initial fetch failed.
    } finally {
      setLoadingComments(false);
    }
  };

  const submitComment = async () => {
    if (!onComment || commentLoading || !commentText.trim()) return;

    setCommentLoading(true);
    setCommentError('');
    try {
      await onComment(message.id, commentText, (newComment) => {
        setLocalCommentsCount((count) => count + 1);
        if (newComment) {
          setComments((current) => (
            current.some((comment) => comment.id === newComment.id)
              ? current
              : [newComment, ...current]
          ));
        }
        setCommentText('');
        setShowCommentForm(false);
      });
    } catch (error) {
      setCommentError(error.message || 'The comment could not be published.');
    } finally {
      setCommentLoading(false);
    }
  };

  const submitRepost = async (quoteContent = '') => {
    if (!onRepost || repostLoading) return;
    const isQuote = Boolean(quoteContent.trim());
    setRepostLoading(true);
    setRepostError('');
    try {
      const result = await onRepost(message.id, quoteContent);
      if (result) {
        if (!isQuote) setLocalUserReposted(Boolean(result.active));
        setLocalRepostsCount(Number(result.reposts_count) || 0);
      }
      setShowRepostOptions(false);
      setShowQuoteComposer(false);
      setQuoteText('');
    } catch (error) {
      setRepostError(error.message || 'The repost could not be saved.');
    } finally {
      setRepostLoading(false);
    }
  };

  const markNotInterested = async () => {
    if (!onNotInterested || feedbackLoading) return;
    setFeedbackLoading(true);
    setFeedbackError('');
    try {
      await onNotInterested(message.id);
    } catch (error) {
      setFeedbackError(error.message || 'Your recommendation could not be updated.');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const applyEditorialPreference = async (preference) => {
    if (!onEditorialPreference || !authorAddress || editorialAction) return;
    if (preference === 'block' && !window.confirm(
      'Block this account? Its posts will disappear from your feeds and interactions between both accounts will be disabled.'
    )) return;

    setEditorialAction(preference);
    setEditorialError('');
    try {
      await onEditorialPreference(authorAddress, preference);
      setShowEditorialMenu(false);
    } catch (error) {
      setEditorialError(error.message || 'This preference could not be saved.');
    } finally {
      setEditorialAction('');
    }
  };

  const reportMessage = async () => {
    if (!onReportMessage || editorialAction) return;
    setEditorialAction('report');
    setEditorialError('');
    try {
      await onReportMessage(message.id);
      setShowEditorialMenu(false);
    } catch (error) {
      setEditorialError(error.message || 'This post could not be reported.');
    } finally {
      setEditorialAction('');
    }
  };

  const applyEditorialTopicPreference = async () => {
    if (!onEditorialTopicPreference || editorialAction) return;
    setEditorialAction('topic-reduce');
    setEditorialError('');
    try {
      await onEditorialTopicPreference(message.id, 'reduce');
      setShowEditorialMenu(false);
    } catch (error) {
      setEditorialError(error.message || 'This topic preference could not be saved.');
    } finally {
      setEditorialAction('');
    }
  };

  const originalMessage = message.reposted_message || null;
  const repostedText = originalMessage?.content || message.content || '';
  const repostedCharacterCount = countBillableCharacters(repostedText);
  const openThreadFromCard = (event) => {
    if (!onOpenThread || event.target.closest('button, a, input, textarea, select, [role="menu"]')) return;
    onOpenThread(message.id);
  };

  return (
    <article onClick={openThreadFromCard} className={`rounded-[1.5rem] border border-white/[0.085] bg-[#11131a] p-4 shadow-[0_18px_50px_-38px_rgba(0,0,0,0.9)] transition hover:border-white/[0.14] sm:p-5 ${onOpenThread ? 'cursor-pointer' : ''}`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {message.avatar_url ? (
            <img src={message.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover shadow-[0_0_22px_rgba(251,191,36,0.12)]" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(251,191,36,0.12)]">
              {avatarLetter}
            </span>
          )}
          <div className="min-w-0">
          <button
            type="button"
            onClick={() => onUserClick?.(authorAddress)}
            disabled={!authorAddress || !onUserClick}
            title={displayAddress}
            className={`block max-w-[180px] truncate text-sm font-bold text-white hover:underline ${
              !authorAddress || !onUserClick ? 'cursor-default hover:no-underline' : ''
            }`}
          >
            {displayAddress}
          </button>
          {isFollowed && (
            <span className="mt-0.5 inline-block rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              Following
            </span>
          )}
          </div>
        </div>

        <div className="relative flex items-center gap-3">
          <span className="whitespace-nowrap text-xs text-white/30">
            {formatMessageTimestamp(message.created_at || message.timestamp)}
          </span>
          {!isOwnMessage && (
            onNotInterested
            || onEditorialPreference
            || onEditorialTopicPreference
            || onReportMessage
          ) && (
            <button
              type="button"
              onClick={() => setShowEditorialMenu((visible) => !visible)}
              disabled={feedbackLoading || Boolean(editorialAction)}
              className="rounded-full p-1 text-white/30 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
              title={optionsLabel}
              aria-label={optionsLabel}
              aria-expanded={showEditorialMenu}
            >
              <Ellipsis className="h-4 w-4" />
            </button>
          )}
          {isOwnMessage && showActions && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="text-red-500 transition hover:text-red-700"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          {!isOwnMessage && (
            <PostOptionsMenu
              visible={showEditorialMenu}
              onNotInterested={onNotInterested ? markNotInterested : null}
              onEditorialPreference={onEditorialPreference ? applyEditorialPreference : null}
              onEditorialTopicPreference={
                onEditorialTopicPreference && message.topic_feedback_available === true
                  ? applyEditorialTopicPreference
                  : null
              }
              onReportMessage={onReportMessage ? reportMessage : null}
              feedbackLoading={feedbackLoading}
              editorialAction={editorialAction}
              contentType={message.parent_id ? 'comment' : 'post'}
            />
          )}
        </div>
      </div>

      {message.repost_of && (
        <div className="mb-2 flex items-center gap-1 text-xs text-white/35">
          <Repeat2 className="h-3 w-3" />
          {message.repost_kind === 'quote' ? 'Quoted' : 'Reposted'}
        </div>
      )}

      {message.parent_message && (
        <button type="button" onClick={() => onOpenThread?.(message.parent_message.id)} disabled={!onOpenThread} className="mb-3 block w-full rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.045] disabled:cursor-default">
          <span className="text-xs font-bold text-white/45">Replying to {message.parent_message.display_name ? `@${message.parent_message.display_name}` : 'a post'}</span>
          <span className="mt-1 block line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-white/55">{message.parent_message.content}</span>
        </button>
      )}

      {message.content && <ExpandableText text={message.content} />}

      {message.repost_of && (
        originalMessage ? (
          <div className="mb-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <button
              type="button"
              onClick={() => onUserClick?.(originalMessage.bitcoin_address)}
              disabled={!originalMessage.bitcoin_address || !onUserClick}
              className="text-xs font-bold text-white/70 hover:underline disabled:no-underline"
            >
              {originalMessage.display_name ? `@${originalMessage.display_name}` : '@anonymous'}
            </button>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/60">
              {originalMessage.content}
            </p>
            <p className="mt-2 text-[11px] text-white/25">
              {formatMessageTimestamp(originalMessage.created_at)}
            </p>
          </div>
        ) : (
          <div className="mb-3 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-white/35">
            Original post unavailable.
          </div>
        )
      )}

      {showActions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.065] pt-3 text-sm">
          <button
            type="button"
            onClick={handleUseful}
            disabled={!onUseful || isOwnMessage || usefulLoading}
            title={isOwnMessage
              ? 'You cannot mark your own post as useful'
              : localUserMarkedUseful
                ? 'Remove Useful (free)'
                : 'Mark as useful (costs 1 shell)'}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition ${
              localUserMarkedUseful
                ? 'bg-amber-300/15 font-semibold text-amber-300'
                : 'text-white/40 hover:bg-amber-300/10 hover:text-amber-300'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Lightbulb className={`h-4 w-4 ${localUserMarkedUseful ? 'fill-current' : ''}`} />
            <span>Useful</span>
            <span>{localUsefulCount}</span>
          </button>

          <button
            type="button"
            aria-label={`Show comments (${localCommentsCount})`}
            onClick={() => {
              setShowComments((current) => !current);
              if (!showComments && !commentsLoaded) loadComments();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-white/40 transition hover:bg-sky-400/10 hover:text-sky-300"
          >
            <MessageCircle className="h-4 w-4" />
            <span>{localCommentsCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRepostOptions((current) => !current)}
            disabled={!onRepost || isOwnMessage}
            className={`flex items-center gap-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
              localUserReposted ? 'font-semibold text-emerald-300' : 'text-white/40 hover:text-emerald-300'
            }`}
            title={isOwnMessage ? 'You cannot repost your own message' : 'Repost'}
          >
            <Repeat2 className="h-4 w-4" />
            <span>{localRepostsCount}</span>
          </button>
        </div>
      )}

      {usefulError && <p className="mt-2 text-xs text-red-600">{usefulError}</p>}
      {repostError && <p className="mt-2 text-xs text-red-600">{repostError}</p>}
      {commentError && <p className="mt-2 text-xs text-red-600">{commentError}</p>}
      {feedbackError && <p className="mt-2 text-xs text-red-600">{feedbackError}</p>}
      {editorialError && <p className="mt-2 text-xs text-red-600">{editorialError}</p>}

      {showActions && (
        <RepostComposer
          showOptions={showRepostOptions}
          showQuoteComposer={showQuoteComposer}
          userHasReposted={localUserReposted}
          repostedCharacterCount={repostedCharacterCount}
          quoteText={quoteText}
          onQuoteTextChange={setQuoteText}
          repostLoading={repostLoading}
          onSubmit={submitRepost}
          onOpenQuote={() => {
            setShowQuoteComposer(true);
            setShowRepostOptions(false);
          }}
          onCloseQuote={() => setShowQuoteComposer(false)}
        />
      )}

      {showComments && (
        <div className="mt-4 border-t border-white/[0.08] pt-4">
          {!showCommentForm && (
            <button
              type="button"
              onClick={() => setShowCommentForm(true)}
              className="mb-3 text-sm font-semibold text-amber-300 hover:text-amber-200"
            >
              + Add a comment
            </button>
          )}

          {showCommentForm && (
            <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Write your comment..."
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-300/50 focus:ring-2 focus:ring-amber-300/10"
                rows={3}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-white/30">{commentText.length} / 1000</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCommentForm(false);
                      setCommentText('');
                    }}
                    className="px-3 py-1 text-sm text-white/40 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitComment}
                    disabled={!commentText.trim() || commentLoading}
                    className="rounded-full bg-amber-300 px-4 py-1.5 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {commentLoading ? 'Publishing...' : 'Publish'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadingComments ? (
            <FeedSkeleton count={2} compact />
          ) : comments.length > 0 ? (
            <div className="space-y-3 border-l-2 border-white/[0.08] pl-4">
              {comments.map((comment) => (
                <MessageCard
                  key={comment.id}
                  message={comment}
                  currentAddress={currentAddress}
                  onUseful={onUseful}
                  onComment={onComment}
                  onLoadComments={onLoadComments}
                  onRepost={onRepost}
                  onDelete={onDelete}
                  onUserClick={onUserClick}
                  onEditorialPreference={onEditorialPreference}
                  onEditorialTopicPreference={onEditorialTopicPreference}
                  onReportMessage={onReportMessage}
                  onOpenThread={onOpenThread}
                  showActions
                />
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-white/30">No comments yet</p>
          )}
        </div>
      )}
    </article>
  );
};

export default MessageCard;
