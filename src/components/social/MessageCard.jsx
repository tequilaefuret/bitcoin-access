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

  return (
    <article className="border-b border-gray-100 pb-4">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onUserClick?.(authorAddress)}
            disabled={!authorAddress || !onUserClick}
            title={displayAddress}
            className={`text-sm font-semibold text-gray-800 hover:underline ${
              !authorAddress || !onUserClick ? 'cursor-default hover:no-underline' : ''
            }`}
          >
            {displayAddress}
          </button>
          {isFollowed && (
            <span className="rounded-full bg-orange-100 px-2 py-1 text-[11px] font-semibold text-orange-700">
              Following
            </span>
          )}
        </div>

        <div className="relative flex items-center gap-3">
          <span className="text-xs text-gray-500">
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
              className="rounded-full p-1 text-gray-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
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
        <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">
          <Repeat2 className="h-3 w-3" />
          {message.repost_kind === 'quote' ? 'Quoted' : 'Reposted'}
        </div>
      )}

      {message.content && <ExpandableText text={message.content} />}

      {message.repost_of && (
        originalMessage ? (
          <div className="mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <button
              type="button"
              onClick={() => onUserClick?.(originalMessage.bitcoin_address)}
              disabled={!originalMessage.bitcoin_address || !onUserClick}
              className="text-xs font-bold text-slate-700 hover:underline disabled:no-underline"
            >
              {originalMessage.display_name ? `@${originalMessage.display_name}` : '@anonymous'}
            </button>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {originalMessage.content}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {formatMessageTimestamp(originalMessage.created_at)}
            </p>
          </div>
        ) : (
          <div className="mb-3 rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            Original post unavailable.
          </div>
        )
      )}

      {showActions && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            onClick={handleUseful}
            disabled={!onUseful || isOwnMessage || usefulLoading}
            title={isOwnMessage
              ? 'You cannot mark your own post as useful'
              : localUserMarkedUseful
                ? 'Remove Useful (free)'
                : 'Mark as useful (costs 1 satoshi)'}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition ${
              localUserMarkedUseful
                ? 'bg-amber-100 font-semibold text-amber-800'
                : 'text-gray-500 hover:bg-amber-50 hover:text-amber-700'
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
            className="flex items-center gap-1 text-gray-500 transition hover:text-orange-600"
          >
            <MessageCircle className="h-4 w-4" />
            <span>{localCommentsCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRepostOptions((current) => !current)}
            disabled={!onRepost || isOwnMessage}
            className={`flex items-center gap-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
              localUserReposted ? 'font-semibold text-green-700' : 'text-gray-500 hover:text-green-600'
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
        <div className="mt-4 border-t border-gray-200 pt-4">
          {!showCommentForm && (
            <button
              type="button"
              onClick={() => setShowCommentForm(true)}
              className="mb-3 text-sm font-semibold text-orange-700 hover:text-orange-900"
            >
              + Add a comment
            </button>
          )}

          {showCommentForm && (
            <div className="mb-4 rounded-lg bg-gray-50 p-3">
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Write your comment..."
                maxLength={1000}
                className="w-full resize-none rounded border p-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
                rows={3}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500">{commentText.length} / 1000</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCommentForm(false);
                      setCommentText('');
                    }}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitComment}
                    disabled={!commentText.trim() || commentLoading}
                    className="rounded bg-orange-600 px-3 py-1 text-sm text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            <div className="space-y-3 border-l-2 border-gray-200 pl-4">
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
                  showActions
                />
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-gray-500">No comments yet</p>
          )}
        </div>
      )}
    </article>
  );
};

export default MessageCard;
