import React from 'react';
import { Quote, Repeat2, X } from 'lucide-react';

const RepostComposer = ({
  showOptions,
  showQuoteComposer,
  userHasReposted,
  repostedCharacterCount,
  quoteText,
  onQuoteTextChange,
  repostLoading,
  onSubmit,
  onOpenQuote,
  onCloseQuote,
}) => (
  <div onClick={(event) => event.stopPropagation()}>
    {showOptions && (
      <div className="mt-3 flex w-fit overflow-hidden rounded-xl border border-white/10 bg-[#191b22] shadow-lg">
        <button
          type="button"
          onClick={() => onSubmit('')}
          disabled={repostLoading}
          aria-label={userHasReposted ? 'Undo repost' : 'Repost'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.06] disabled:opacity-50"
        >
          <Repeat2 className="h-4 w-4" />
          {userHasReposted ? 'Undo repost' : 'Repost'}
          {!userHasReposted && (
            <span aria-hidden="true" className="text-xs font-normal text-white/30">
              {repostedCharacterCount} shells
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenQuote}
          className="inline-flex items-center gap-2 border-l border-white/10 px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.06]"
        >
          <Quote className="h-4 w-4" />
          Quote
        </button>
      </div>
    )}

    {showQuoteComposer && (
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-white/35">Add a comment</span>
          <button type="button" onClick={onCloseQuote} className="text-white/30 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={quoteText}
          onChange={(event) => onQuoteTextChange(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Why are you sharing this?"
          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-300/50"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-white/30">
            {quoteText.length} / 1000 · {repostedCharacterCount + quoteText.trim().replace(/\n/g, '').length} shells
          </span>
          <button
            type="button"
            onClick={() => onSubmit(quoteText.trim())}
            disabled={!quoteText.trim() || repostLoading}
            className="rounded-full bg-amber-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
          >
            Publish quote
          </button>
        </div>
      </div>
    )}
  </div>
);

export default RepostComposer;
