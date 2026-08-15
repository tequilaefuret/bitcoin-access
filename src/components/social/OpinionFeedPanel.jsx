import React from 'react';
import {
  ArrowRight,
  Clock3,
  Flame,
  Loader,
  Lock,
  MessageSquareText,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { OpinionFeedSkeleton } from '../ui/ContentSkeletons';

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

const OpinionFeedPanel = ({
  topics,
  selectedTopic,
  nextTopics,
  onSelectTopic,
  isLoading,
  renderMessage,
  isSavingStance,
  onPrivateStance
}) => isLoading ? (
  <OpinionFeedSkeleton />
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
              onSelect={() => onSelectTopic(topic.id)}
            />
          ))}
        </div>
      </div>
    </aside>

    <main className="min-w-0 space-y-6">
      {!selectedTopic ? (
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
                  onClick={() => onPrivateStance(stance.id)}
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
                  onClick={() => onSelectTopic(topic.id)}
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
);

export default OpinionFeedPanel;
