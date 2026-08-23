import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Lightbulb,
  MessageCircle,
  Repeat2,
  Trash2,
  X,
} from 'lucide-react';
import PostOptionsMenu from './PostOptionsMenu';
import CommentComposer from './CommentComposer';
import RepostComposer from './RepostComposer';
import {
  countBillableCharacters,
  formatMessageTimestamp,
} from '../../features/social/messagePresentation';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const pointerDistance = (points) => Math.hypot(
  points[0].clientX - points[1].clientX,
  points[0].clientY - points[1].clientY,
);

const useDesktopLayout = () => {
  const [desktop, setDesktop] = useState(() => (
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(min-width: 1024px)').matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return desktop;
};

const ThreadPanel = ({ thread, loading, error, focusId }) => {
  const focusRef = useRef(null);
  const messages = useMemo(() => (
    thread?.root ? [thread.root, ...(thread.comments || [])] : []
  ), [thread]);

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'center' });
  }, [messages.length, focusId]);

  return (
    <aside className="hidden h-full w-[390px] shrink-0 border-l border-white/10 bg-[#0d0f15] lg:flex lg:flex-col">
      <header className="border-b border-white/10 px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Conversation</p>
        <p className="mt-1 text-sm text-white/45">Scroll to read the post and its replies</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="py-10 text-center text-sm text-white/35">Loading conversation…</p>}
        {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
        {!loading && !error && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-white/35">Conversation unavailable.</p>
        )}
        <div className="space-y-3">
          {messages.map((item) => {
            const focused = item.id === focusId;
            return (
              <article
                key={item.id}
                ref={focused ? focusRef : null}
                className={`rounded-2xl border p-4 ${focused ? 'border-amber-300/45 bg-amber-300/[0.07]' : 'border-white/[0.08] bg-white/[0.025]'}`}
              >
                <div className="flex items-center gap-2">
                  {item.avatar_url ? (
                    <img src={item.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-300 text-xs font-black text-slate-950">
                      {(item.display_name || 'A').trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white/80">{item.display_name ? `@${item.display_name}` : '@anonymous'}</p>
                    <p className="text-[11px] text-white/25">{formatMessageTimestamp(item.created_at)}</p>
                  </div>
                </div>
                {item.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/65">{item.content}</p>}
                {Array.isArray(item.media) && item.media.length > 0 && (
                  <div className="mt-3 flex gap-1 overflow-hidden rounded-xl">
                    {item.media.slice(0, 3).map((photo, index) => (
                      <img key={`${photo.url}-${index}`} src={photo.url} alt="" className="h-16 min-w-0 flex-1 object-cover" />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

const PostMediaViewer = ({
  message,
  photos,
  initialIndex = 0,
  currentAddress,
  onClose,
  onUseful,
  onComment,
  onRepost,
  onDelete,
  onNotInterested,
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
  onLoadThread,
}) => {
  const isDesktop = useDesktopLayout();
  const [index, setIndex] = useState(clamp(initialIndex, 0, Math.max(0, photos.length - 1)));
  const [chromeVisible, setChromeVisible] = useState(true);
  const [scale, setScale] = useState(1);
  const [translation, setTranslation] = useState({ x: 0, y: 0 });
  const [showOptions, setShowOptions] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [showRepost, setShowRepost] = useState(false);
  const [quoteText, setQuoteText] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [actionError, setActionError] = useState('');
  const [usefulActive, setUsefulActive] = useState(Boolean(message.user_has_marked_useful));
  const [usefulCount, setUsefulCount] = useState(Number(message.useful_count) || 0);
  const [commentsCount, setCommentsCount] = useState(Number(message.comments_count) || 0);
  const [repostsCount, setRepostsCount] = useState(Number(message.reposts_count) || 0);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const isOwnMessage = message.bitcoin_address === currentAddress;
  const controlsVisible = isDesktop || chromeVisible;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1));
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(photos.length - 1, current + 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, photos.length]);

  useEffect(() => {
    setScale(1);
    setTranslation({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    if (!isDesktop || !onLoadThread || thread) return;
    let cancelled = false;
    setThreadLoading(true);
    setThreadError('');
    onLoadThread(message.id)
      .then((result) => { if (!cancelled) setThread(result); })
      .catch((error) => { if (!cancelled) setThreadError(error.message || 'Unable to load this conversation.'); })
      .finally(() => { if (!cancelled) setThreadLoading(false); });
    return () => { cancelled = true; };
  }, [isDesktop, message.id, onLoadThread, thread]);

  const movePhoto = (direction) => {
    setIndex((current) => clamp(current + direction, 0, photos.length - 1));
  };

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const points = [...pointersRef.current.values()];
    gestureRef.current = points.length >= 2
      ? { kind: 'pinch', distance: pointerDistance(points), scale, moved: false }
      : {
          kind: 'single',
          startX: event.clientX,
          startY: event.clientY,
          translation,
          moved: false,
        };
  };

  const handlePointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) return;
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const distance = pointerDistance(points);
      const nextScale = clamp(gestureRef.current.scale * (distance / Math.max(1, gestureRef.current.distance)), 1, 4);
      gestureRef.current.moved = true;
      setScale(nextScale);
      if (nextScale === 1) setTranslation({ x: 0, y: 0 });
      return;
    }
    if (gestureRef.current.kind !== 'single') return;
    const dx = event.clientX - gestureRef.current.startX;
    const dy = event.clientY - gestureRef.current.startY;
    if (Math.hypot(dx, dy) > 6) gestureRef.current.moved = true;
    if (scale > 1) {
      setTranslation({
        x: gestureRef.current.translation.x + dx,
        y: gestureRef.current.translation.y + dy,
      });
    }
  };

  const handlePointerUp = (event) => {
    const gesture = gestureRef.current;
    const point = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (!gesture || !point || pointersRef.current.size > 0) return;
    if (gesture.kind === 'single' && scale === 1) {
      const dx = point.clientX - gesture.startX;
      if (Math.abs(dx) > 55) movePhoto(dx < 0 ? 1 : -1);
      else if (!gesture.moved && !isDesktop) setChromeVisible((visible) => !visible);
    }
    gestureRef.current = null;
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const nextScale = clamp(scale + (event.deltaY < 0 ? 0.25 : -0.25), 1, 4);
    setScale(nextScale);
    if (nextScale === 1) setTranslation({ x: 0, y: 0 });
  };

  const handleUseful = async () => {
    if (!onUseful || isOwnMessage || actionLoading) return;
    setActionLoading('useful');
    setActionError('');
    try {
      const result = await onUseful(message.id);
      setUsefulActive(Boolean(result?.active));
      setUsefulCount(Number(result?.useful_count) || 0);
    } catch (error) {
      setActionError(error.message || 'Useful could not be updated.');
    } finally {
      setActionLoading('');
    }
  };

  const submitComment = async (content, mediaFiles) => {
    if (!onComment) return false;
    return onComment(message.id, content, mediaFiles, () => {
      setCommentsCount((count) => count + 1);
      setShowComment(false);
    });
  };

  const submitRepost = async (quote = '', mediaFiles = []) => {
    if (!onRepost || isOwnMessage || actionLoading) return null;
    setActionLoading('repost');
    setActionError('');
    try {
      const result = mediaFiles.length > 0
        ? await onRepost(message.id, quote, mediaFiles)
        : await onRepost(message.id, quote);
      setRepostsCount(Number(result?.reposts_count) || 0);
      setQuoteText('');
      setShowRepost(false);
      return result;
    } catch (error) {
      setActionError(error.message || 'The repost could not be saved.');
      return null;
    } finally {
      setActionLoading('');
    }
  };

  const runOption = async (callback) => {
    setActionError('');
    try {
      await callback();
      setShowOptions(false);
    } catch (error) {
      setActionError(error.message || 'This action could not be completed.');
    }
  };

  const currentPhoto = photos[index];
  const modal = (
    <div className="fixed inset-0 z-[120] flex bg-black text-white" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-black">
        <div
          data-testid="photo-interaction-surface"
          className="relative min-h-0 flex-1 select-none overflow-hidden"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={() => {
            const nextScale = scale > 1 ? 1 : 2;
            setScale(nextScale);
            if (nextScale === 1) setTranslation({ x: 0, y: 0 });
          }}
        >
          <img
            src={currentPhoto.url}
            alt={`Post attachment ${index + 1} enlarged`}
            draggable="false"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain will-change-transform"
            style={{ transform: `translate3d(${translation.x}px, ${translation.y}px, 0) scale(${scale})` }}
          />

          <div onPointerDown={(event) => event.stopPropagation()} className={`absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/80 to-transparent p-3 transition-opacity ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label="Close photo viewer"><X className="h-6 w-6" /></button>
            <div className="relative">
              <button type="button" onClick={() => setShowOptions((visible) => !visible)} className="grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label="Post options"><Ellipsis className="h-6 w-6" /></button>
              {isOwnMessage ? showOptions && (
                <div className="absolute right-0 top-12 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#171922] p-1 shadow-2xl">
                  {onDelete ? (
                    <button type="button" onClick={() => runOption(async () => { await onDelete(message.id); onClose(); })} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-300 hover:bg-white/[0.06]"><Trash2 className="h-4 w-4" />Delete publication</button>
                  ) : (
                    <p className="px-4 py-3 text-sm text-white/45">No available action.</p>
                  )}
                </div>
              ) : (
                <PostOptionsMenu
                  visible={showOptions}
                  onNotInterested={onNotInterested ? () => runOption(() => onNotInterested(message.id)) : null}
                  onEditorialPreference={onEditorialPreference ? (preference) => runOption(() => onEditorialPreference(message.bitcoin_address, preference)) : null}
                  onEditorialTopicPreference={onEditorialTopicPreference ? () => runOption(() => onEditorialTopicPreference(message.id, 'reduce')) : null}
                  onReportMessage={onReportMessage ? () => runOption(() => onReportMessage(message.id)) : null}
                  contentType={message.parent_id ? 'comment' : 'post'}
                />
              )}
            </div>
          </div>

          {photos.length > 1 && scale === 1 && (
            <>
              <button type="button" onClick={() => movePhoto(-1)} disabled={index === 0} className={`absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur transition lg:grid ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'} disabled:opacity-20`} aria-label="Previous photo"><ChevronLeft className="h-7 w-7" /></button>
              <button type="button" onClick={() => movePhoto(1)} disabled={index === photos.length - 1} className={`absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur transition lg:grid ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'} disabled:opacity-20`} aria-label="Next photo"><ChevronRight className="h-7 w-7" /></button>
            </>
          )}

          {photos.length > 1 && (
            <div className={`absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs font-bold backdrop-blur transition-opacity ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>{index + 1} / {photos.length}</div>
          )}
        </div>

        <div data-testid="photo-viewer-actions" className={`relative z-30 border-t border-white/10 bg-black/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform ${controlsVisible ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}`}>
          {actionError && <p className="mb-2 text-center text-xs text-red-300">{actionError}</p>}
          {showComment && (
            <div className="mx-auto mb-3 max-w-xl">
              <CommentComposer
                onSubmit={submitComment}
                onCancel={() => setShowComment(false)}
                submitLabel="Send"
                compact
              />
            </div>
          )}
          {showRepost && (
            <div className="mx-auto mb-3 max-w-xl rounded-2xl border border-white/10 bg-white/[0.06] p-3">
              <button type="button" onClick={() => submitRepost('')} disabled={Boolean(actionLoading)} className="w-full rounded-xl bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">Repost without comment</button>
              <RepostComposer
                showOptions={false}
                showQuoteComposer
                userHasReposted={false}
                repostedCharacterCount={countBillableCharacters(message.reposted_message?.content || message.content || '')}
                quoteText={quoteText}
                onQuoteTextChange={setQuoteText}
                repostLoading={Boolean(actionLoading)}
                onSubmit={submitRepost}
                onCloseQuote={() => {
                  setQuoteText('');
                  setShowRepost(false);
                }}
              />
            </div>
          )}
          <div className="mx-auto flex max-w-xl items-center justify-around">
            <button type="button" onClick={handleUseful} disabled={!onUseful || isOwnMessage || Boolean(actionLoading)} className={`flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-xs ${usefulActive ? 'text-amber-300' : 'text-white/65'} disabled:opacity-35`}><Lightbulb className={`h-5 w-5 ${usefulActive ? 'fill-current' : ''}`} /><span>Useful {usefulCount}</span></button>
            <button type="button" onClick={() => { setShowComment((visible) => !visible); setShowRepost(false); }} className="flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-xs text-white/65"><MessageCircle className="h-5 w-5" /><span>Comment {commentsCount}</span></button>
            <button type="button" onClick={() => { setShowRepost((visible) => !visible); setShowComment(false); }} disabled={!onRepost || isOwnMessage} className="flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-xs text-white/65 disabled:opacity-35"><Repeat2 className="h-5 w-5" /><span>Repost {repostsCount}</span></button>
          </div>
        </div>
      </section>

      <ThreadPanel thread={thread} loading={threadLoading} error={threadError} focusId={message.id} />
    </div>
  );

  return createPortal(modal, document.body);
};

export default PostMediaViewer;
