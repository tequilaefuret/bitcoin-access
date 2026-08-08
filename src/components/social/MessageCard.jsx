import React, { useState } from 'react';
import { Lightbulb, MessageCircle, Quote, Repeat2, Trash2, X } from 'lucide-react';

const TEXT_PREVIEW_LENGTH = 150;

const ExpandableText = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const safeText = text || '';
  const isLong = safeText.length > TEXT_PREVIEW_LENGTH;
  const visibleText = expanded || !isLong
    ? safeText
    : `${safeText.slice(0, TEXT_PREVIEW_LENGTH).trim()}...`;

  return (
    <div className="mb-3 text-gray-700">
      <p className="whitespace-pre-wrap">{visibleText}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-xs font-semibold text-orange-700 hover:text-orange-900"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
};

const MessageCard = ({
  message,
  currentAddress,
  onUseful,
  onComment,
  onLoadComments,
  onRepost,
  onDelete,
  onUserClick,
  isFollowed = false,
  showActions = true
}) => {
  const [showComments, setShowComments] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
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

  const authorAddress = message.bitcoin_address || null;
  const isOwnMessage = authorAddress === currentAddress;

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

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
      setComments(loadedComments || []);
      setCommentsLoaded(true);
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
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

  const originalMessage = message.reposted_message || null;
  const repostedText = originalMessage?.content || message.content || '';
  const repostedCharacterCount = repostedText.replace(/\n/g, '').length;
  const quotedCharacterCount = quoteText.trim().replace(/\n/g, '').length;

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

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {formatTimestamp(message.created_at || message.timestamp)}
          </span>
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
              {formatTimestamp(originalMessage.created_at)}
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

      {showActions && showRepostOptions && (
        <div className="mt-3 flex w-fit overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => submitRepost('')}
            disabled={repostLoading}
            aria-label={localUserReposted ? 'Undo repost' : 'Repost'}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Repeat2 className="h-4 w-4" />
            {localUserReposted ? 'Undo repost' : 'Repost'}
            {!localUserReposted && (
              <span aria-hidden="true" className="text-xs font-normal text-slate-400">
                {repostedCharacterCount} sats
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowQuoteComposer(true);
              setShowRepostOptions(false);
            }}
            className="inline-flex items-center gap-2 border-l border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Quote className="h-4 w-4" />
            Quote
          </button>
        </div>
      )}

      {showActions && showQuoteComposer && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Add a comment</span>
            <button type="button" onClick={() => setShowQuoteComposer(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={quoteText}
            onChange={(event) => setQuoteText(event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Why are you sharing this?"
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-orange-400"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              {quoteText.length} / 1000 · {repostedCharacterCount + quotedCharacterCount} sats
            </span>
            <button
              type="button"
              onClick={() => submitRepost(quoteText.trim())}
              disabled={!quoteText.trim() || repostLoading}
              className="rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Publish quote
            </button>
          </div>
        </div>
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
                    onClick={async () => {
                      if (!onComment) return;
                      await onComment(message.id, commentText, (newComment) => {
                        setLocalCommentsCount((count) => count + 1);
                        if (newComment) setComments((current) => [newComment, ...current]);
                        setCommentText('');
                        setShowCommentForm(false);
                      });
                    }}
                    disabled={!commentText.trim()}
                    className="rounded bg-orange-600 px-3 py-1 text-sm text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadingComments ? (
            <p className="text-sm text-gray-500">Loading comments...</p>
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
