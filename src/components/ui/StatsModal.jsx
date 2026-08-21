import React, { useMemo } from 'react';
import { History, Loader2, X } from 'lucide-react';
import { ListSkeleton } from './ContentSkeletons';
import { canShowShellBalance, formatShellAmount } from '../../lib/displayPreferences';

const formatDate = (value) => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const eventStyle = {
  message: 'border-orange-300/15 bg-orange-300/[0.055]',
  comment: 'border-amber-300/15 bg-amber-300/[0.05]',
  repost: 'border-emerald-300/15 bg-emerald-300/[0.05]',
  quote: 'border-emerald-300/15 bg-emerald-300/[0.05]',
  like: 'border-sky-300/15 bg-sky-300/[0.05]',
  dislike: 'border-rose-300/15 bg-rose-300/[0.05]',
  game: 'border-violet-300/15 bg-violet-300/[0.05]',
  canvas: 'border-teal-300/15 bg-teal-300/[0.05]',
  read_messages: 'border-white/10 bg-white/[0.035]',
  useful: 'border-yellow-300/15 bg-yellow-300/[0.05]',
  profile_media_lock: 'border-fuchsia-300/15 bg-fuchsia-300/[0.05]',
  profile_avatar_lock: 'border-fuchsia-300/15 bg-fuchsia-300/[0.05]',
  profile_avatar_unlock: 'border-fuchsia-300/15 bg-fuchsia-300/[0.05]',
  profile_cover_lock: 'border-indigo-300/15 bg-indigo-300/[0.05]',
  profile_cover_unlock: 'border-indigo-300/15 bg-indigo-300/[0.05]',
};

export const groupConsecutiveHistory = (history) => history.reduce((groups, event) => {
  const key = event.event_key || event.type || 'event';
  const previous = groups[groups.length - 1];
  if (previous?.event_key === key) {
    previous.amount += Number(event.amount || 0);
    previous.action_count += Number(event.action_count || 1);
    previous.start_at = event.created_at || previous.start_at;
    previous.events.push(event);
    return groups;
  }

  groups.push({
    ...event,
    event_key: key,
    amount: Number(event.amount || 0),
    action_count: Number(event.action_count || 1),
    start_at: event.created_at,
    end_at: event.created_at,
    events: [event],
  });
  return groups;
}, []);

const plural = (count, singular, pluralLabel = `${singular}s`) => (
  `${count} ${count === 1 ? singular : pluralLabel}`
);

const describeGroup = (group) => {
  const count = group.action_count;
  const amount = formatShellAmount(Math.abs(group.amount));
  switch (group.event_key) {
    case 'read_messages': return `${plural(count, 'message')} loaded`;
    case 'canvas': return `${plural(count, 'pixel')} placed`;
    case 'message': return group.events.length === 1 ? group.description : `${plural(count, 'post')} published`;
    case 'comment': return `${plural(count, 'comment')} published`;
    case 'repost': return `${plural(count, 'repost')} published`;
    case 'quote': return `${plural(count, 'quoted repost')} published`;
    case 'like': return `${plural(count, 'post')} liked`;
    case 'dislike': return `${plural(count, 'post')} disliked`;
    case 'useful': return `${plural(count, 'post')} marked Useful`;
    case 'game': return plural(count, 'game session');
    case 'profile_avatar_lock': return `${amount} shells locked for the profile photo`;
    case 'profile_avatar_unlock': return `${amount} shells unlocked from the profile photo`;
    case 'profile_cover_lock': return `${amount} shells locked for the cover photo`;
    case 'profile_cover_unlock': return `${amount} shells unlocked from the cover photo`;
    case 'profile_media_lock': return `${amount} shells ${group.amount > 0 ? 'unlocked' : 'locked'} for profile media`;
    default: return group.description || plural(count, 'action');
  }
};

const DateRange = ({ start, end }) => (
  <span className="text-xs text-white/30">
    {start && end && start !== end ? `${formatDate(start)} — ${formatDate(end)}` : formatDate(end || start)}
  </span>
);

const ModalFrame = ({ onClose, children }) => (
  <div
    className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    {children}
  </div>
);

const StatsModal = ({ stats, onClose, onLoadMore, loadingMore = false, balanceDisplay = 'show_all' }) => {
  const history = useMemo(
    () => (Array.isArray(stats?.history) ? stats.history : []),
    [stats?.history]
  );
  const groupedHistory = useMemo(() => groupConsecutiveHistory(history), [history]);

  if (!stats) {
    return (
      <ModalFrame onClose={onClose}>
        <div role="dialog" aria-modal="true" aria-label="Spending history" className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-[#11131a] p-6 text-white shadow-[0_32px_100px_rgba(0,0,0,0.7)]">
          <ListSkeleton label="Loading spending history" count={3} />
        </div>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="spending-history-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[1.75rem] border border-white/10 bg-[#11131a] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,0.72)] sm:p-6">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="spending-history-title" className="flex items-center gap-2 text-2xl font-black tracking-[-0.035em]"><History className="h-6 w-6 text-amber-300" /> Spending history</h2>
            <p className="mt-1 text-sm text-white/40">Shells spent, locked and unlocked by your activity.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/35 transition hover:bg-white/[0.06] hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="mb-5 inline-flex rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1 text-xs font-semibold text-white/40">{history.length} events tracked</div>

        {groupedHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
            <p className="font-semibold text-white/65">No shell activity yet.</p>
            <p className="mt-2 text-sm text-white/35">Your paid actions and refundable locks will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedHistory.map((group) => (
              <article key={group.id} className={`rounded-2xl border p-4 ${eventStyle[group.event_key] || eventStyle.read_messages}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <DateRange start={group.start_at} end={group.end_at} />
                    <p className="mt-2 break-words text-sm font-semibold leading-6 text-white/75">{describeGroup(group)}</p>
                  </div>
                  <p className={`shrink-0 text-lg font-black ${group.amount > 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                    {canShowShellBalance(balanceDisplay) ? `${group.amount > 0 ? '+' : '-'}${formatShellAmount(Math.abs(group.amount))} shells` : 'Hidden'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}

        {stats.hasMore && (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-6 py-3 font-semibold text-white/65 transition hover:bg-white/[0.075] hover:text-white disabled:opacity-50">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? 'Loading previous events...' : 'Show 20 previous events'}
          </button>
        )}
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl bg-amber-300 px-6 py-3 font-extrabold text-slate-950 transition hover:bg-amber-200">Close</button>
      </div>
    </ModalFrame>
  );
};

export default StatsModal;
