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
  <>
    {showOptions && (
      <div className="mt-3 flex w-fit overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <button
          type="button"
          onClick={() => onSubmit('')}
          disabled={repostLoading}
          aria-label={userHasReposted ? 'Undo repost' : 'Repost'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Repeat2 className="h-4 w-4" />
          {userHasReposted ? 'Undo repost' : 'Repost'}
          {!userHasReposted && (
            <span aria-hidden="true" className="text-xs font-normal text-slate-400">
              {repostedCharacterCount} sats
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenQuote}
          className="inline-flex items-center gap-2 border-l border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Quote className="h-4 w-4" />
          Quote
        </button>
      </div>
    )}

    {showQuoteComposer && (
      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Add a comment</span>
          <button type="button" onClick={onCloseQuote} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={quoteText}
          onChange={(event) => onQuoteTextChange(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Why are you sharing this?"
          className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-orange-400"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {quoteText.length} / 1000 · {repostedCharacterCount + quoteText.trim().replace(/\n/g, '').length} sats
          </span>
          <button
            type="button"
            onClick={() => onSubmit(quoteText.trim())}
            disabled={!quoteText.trim() || repostLoading}
            className="rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Publish quote
          </button>
        </div>
      </div>
    )}
  </>
);

export default RepostComposer;
