import React, { useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { getMessageThread } from '../../supabaseClient';
import MessageCard from '../social/MessageCard';
import { FeedSkeleton } from '../ui/ContentSkeletons';
import { friendlyShellError } from '../../lib/shells';

const ThreadStep = ({
  messageId,
  currentAddress,
  onBack,
  onOpenProfile,
  onOpenThread,
  onPublishMessage,
  onLoadComments,
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getMessageThread(currentAddress, messageId)
      .then((result) => {
        if (cancelled) return;
        setThread(result);
        onBalanceUpdated?.(result);
        window.requestAnimationFrame(() => {
          document.getElementById(`thread-${result.focus_id}`)?.scrollIntoView({ block: 'center' });
        });
      })
      .catch((loadError) => !cancelled && setError(friendlyShellError(loadError, 'Unable to load this conversation')))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [currentAddress, messageId, onBalanceUpdated]);

  const handleComment = async (parentId, content, onSuccess) => {
    const result = await onPublishMessage?.(content.trim(), parentId);
    if (result && result.success !== false) onSuccess?.(result.message || null);
    return result;
  };

  const sharedProps = {
    currentAddress,
    onUserClick: onOpenProfile,
    onOpenThread,
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
        <div className="flex items-center gap-2 px-2 pt-4 text-xs font-bold uppercase tracking-[0.15em] text-white/35"><MessageCircle className="h-4 w-4" /> Replies</div>
        {thread.comments?.map((comment) => <div key={comment.id} id={`thread-${comment.id}`} className="border-l border-white/[0.1] pl-3 sm:pl-5"><MessageCard message={comment} {...sharedProps} /></div>)}
        {thread.comments?.length === 0 && <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">No replies yet.</p>}
      </div>}
    </main>
  );
};

export default ThreadStep;
