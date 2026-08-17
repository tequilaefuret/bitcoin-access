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
          ? 'bg-orange-400/10 text-orange-300'
          : status === 'declining'
            ? 'bg-white/[0.06] text-white/35'
            : 'bg-emerald-400/10 text-emerald-300'
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
        ? 'border-amber-300/30 bg-amber-300/10 text-white shadow-lg shadow-black/20'
        : 'border-white/[0.08] bg-white/[0.025] text-white hover:border-white/15 hover:bg-white/[0.045]'
    }`}
  >
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
        {topic.category}
      </span>
      <div className="flex items-center gap-2">
        <TrendBadge topic={topic} active={active} />
        <span className="flex items-center gap-1 text-xs text-white/35">
          <MessageSquareText className="h-3.5 w-3.5" />
          {topic.posts?.length || 0}
        </span>
      </div>
    </div>
    <h3 className="mt-2 text-base font-black">{topic.title}</h3>
    <p className="mt-2 text-sm leading-6 text-white/50">
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
      <div className="rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] p-4 shadow-lg shadow-black/20 lg:sticky lg:top-[88px]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">Opinion topics</p>
        <h3 className="mt-1 text-xl font-black text-white">Choose a question</h3>
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
        <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.025] p-10 text-center text-sm text-white/35">
          No Opinion topics are active yet.
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] shadow-lg shadow-black/20">
            <div className="border-b border-white/[0.08] bg-white/[0.025] px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">{selectedTopic.category}</p>
                <TrendBadge topic={selectedTopic} />
              </div>
              <h3 className="mt-2 text-3xl font-black tracking-tight text-white">{selectedTopic.title}</h3>
              <p className="mt-3 text-base font-medium leading-7 text-white/60">{selectedTopic.question}</p>
              <div className="mt-4 flex items-center gap-2 text-xs text-white/35">
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                Posts are selected by topic relevance and usefulness, then shown without orientation labels.
              </div>
            </div>

            <div className="p-6">
              {(selectedTopic.posts || []).length > 0 ? (
                <div className="space-y-5">{selectedTopic.posts.map(renderMessage)}</div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-8 text-center">
                  <p className="font-semibold text-white/65">No real posts have been selected for this topic yet.</p>
                  <p className="mt-2 text-sm leading-6 text-white/35">
                    Useful posts from the Classic feed will enter this topic automatically once the model is confident enough.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] p-6 shadow-lg shadow-black/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/30">
                  <Lock className="h-3.5 w-3.5" />
                  Private position
                </div>
                <h4 className="mt-2 text-2xl font-black text-white">Where do you stand now?</h4>
                <p className="mt-2 text-sm leading-6 text-white/45">
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
                      ? 'border-amber-300 bg-amber-300 text-slate-950'
                      : 'border-white/[0.08] bg-white/[0.035] text-white/50 hover:border-white/15 hover:text-white'
                  }`}
                >
                  {stance.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] p-6 shadow-lg shadow-black/20">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">Next topics</p>
            <div className="mt-4 space-y-3">
              {nextTopics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => onSelectTopic(topic.id)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-white/15 hover:bg-white/[0.045]"
                >
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">{topic.category}</span>
                    <p className="mt-1 font-bold text-white">{topic.title}</p>
                    <p className="mt-1 text-sm text-white/45">{topic.question}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-white/25" />
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
