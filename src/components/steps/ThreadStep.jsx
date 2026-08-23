import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Clock3, Lightbulb, LoaderCircle, MessageCircle } from 'lucide-react';
import MessageCard from '../social/MessageCard';
import { FeedSkeleton } from '../ui/ContentSkeletons';
import { friendlyShellError } from '../../lib/shells';

const ThreadStep = ({
  messageId,
  currentAddress,
  displayName,
  avatarUrl,
  onBack,
  onOpenProfile,
  onOpenThread,
  onPublishMessage,
  onLoadComments,
  onLoadThread,
  onToggleUseful,
  onRepostMessage,
  onBalanceUpdated,
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
}) => {
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replySort, setReplySort] = useState('recent');
  const [replySortLoading, setReplySortLoading] = useState('');
  const [showReplySortMenu, setShowReplySortMenu] = useState(false);
  const replySortMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setReplySort('recent');
    setReplySortLoading('');
    setShowReplySortMenu(false);
    onLoadThread(messageId, 'recent')
      .then((result) => {
        if (cancelled) return;
        setThread(result);
        onBalanceUpdated?.(result);
        window.requestAnimationFrame(() => {
          document.getElementById(`thread-${result.focus_id}`)?.scrollIntoView?.({ block: 'center' });
        });
      })
      .catch((loadError) => !cancelled && setError(friendlyShellError(loadError, 'Unable to load this conversation')))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [messageId, onBalanceUpdated, onLoadThread]);

  useEffect(() => {
    if (!showReplySortMenu) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!replySortMenuRef.current?.contains(event.target)) setShowReplySortMenu(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setShowReplySortMenu(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showReplySortMenu]);

  const handleReplySortChange = async (nextSort) => {
    setShowReplySortMenu(false);
    if (nextSort === replySort || replySortLoading) return;

    setReplySortLoading(nextSort);
    setError('');
    try {
      const result = await onLoadThread(messageId, nextSort);
      setThread(result);
      setReplySort(nextSort);
      onBalanceUpdated?.(result);
    } catch (sortError) {
      setError(friendlyShellError(sortError, 'Unable to sort replies'));
    } finally {
      setReplySortLoading('');
    }
  };

  const handleComment = async (parentId, content, mediaFiles = [], onSuccess) => {
    const result = await onPublishMessage?.(content.trim(), parentId, mediaFiles);
    if (result && result.success !== false) {
      const published = result.message ? {
        ...result.message,
        display_name: displayName || null,
        avatar_url: avatarUrl || null,
        useful_count: Number(result.message.useful_count) || 0,
        comments_count: Number(result.message.comments_count) || 0,
        reposts_count: Number(result.message.reposts_count) || 0,
        user_has_marked_useful: false,
        user_has_reposted: false,
      } : null;
      if (published) {
        setThread((current) => current ? {
          ...current,
          comments: [
            published,
            ...(current.comments || []).filter((comment) => comment.id !== published.id),
          ],
        } : current);
      }
      onSuccess?.(published);
    }
    return result;
  };

  const sharedProps = {
    currentAddress,
    onUserClick: onOpenProfile,
    onOpenThread,
    onLoadThread,
    onUseful: onToggleUseful,
    onComment: handleComment,
    onLoadComments,
    onRepost: onRepostMessage,
    onEditorialPreference,
    onEditorialTopicPreference,
    onReportMessage,
    showActions: true,
  };

  return (
    <main className="mx-auto max-w-3xl pb-12">
      <div className="sticky top-[68px] z-20 -mx-4 mb-4 flex items-center gap-3 border-b border-white/[0.08] bg-[#07080c]/90 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border">
        <button type="button" onClick={onBack} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.06] hover:text-white"><ArrowLeft className="h-5 w-5" /></button>
        <div><h1 className="text-lg font-black text-white">Conversation</h1><p className="text-xs text-white/35">Post and replies</p></div>
      </div>
      {loading && <FeedSkeleton count={4} />}
      {error && <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}
      {!loading && thread?.root && <div className="space-y-3">
        <div id={`thread-${thread.root.id}`}><MessageCard message={thread.root} {...sharedProps} /></div>
        <div className="flex items-center justify-between gap-3 px-2 pt-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-white/35"><MessageCircle className="h-4 w-4" /> Replies</div>
          <div ref={replySortMenuRef} className="relative">
            <button
              type="button"
              aria-label={`Sort replies: ${replySort === 'useful' ? 'Useful' : 'Recent'}`}
              aria-haspopup="menu"
              aria-expanded={showReplySortMenu}
              disabled={Boolean(replySortLoading)}
              onClick={() => setShowReplySortMenu((visible) => !visible)}
              className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 text-[11px] font-semibold text-white/55 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white/80 disabled:cursor-wait disabled:opacity-60"
            >
              {replySortLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : replySort === 'useful' ? <Lightbulb className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              <span>{replySort === 'useful' ? 'Useful' : 'Recent'}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showReplySortMenu ? 'rotate-180' : ''}`} />
            </button>
            {showReplySortMenu && (
              <div role="menu" aria-label="Reply reading mode" className="absolute right-0 top-10 z-30 w-36 overflow-hidden rounded-xl border border-white/[0.1] bg-[#171920] p-1.5 shadow-2xl shadow-black/50">
                {[
                  { id: 'recent', label: 'Recent', Icon: Clock3 },
                  { id: 'useful', label: 'Useful', Icon: Lightbulb },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={replySort === id}
                    onClick={() => handleReplySortChange(id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition ${replySort === id ? 'bg-amber-300/10 text-amber-200' : 'text-white/55 hover:bg-white/[0.06] hover:text-white'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {thread.comments?.map((comment) => <div key={comment.id} id={`thread-${comment.id}`} className="border-l border-white/[0.1] pl-3 sm:pl-5"><MessageCard message={comment} {...sharedProps} /></div>)}
        {thread.comments?.length === 0 && <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">No replies yet.</p>}
      </div>}
    </main>
  );
};

export default ThreadStep;
