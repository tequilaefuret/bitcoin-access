import React from 'react';
import { Ban, EyeOff, Flag, UserMinus } from 'lucide-react';

const PostOptionsMenu = ({
  visible,
  onNotInterested,
  onEditorialPreference,
  onReportMessage,
  feedbackLoading,
  editorialAction,
}) => {
  if (!visible) return null;

  return (
    <div className="absolute right-0 top-7 z-20 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 text-left shadow-xl">
      {onNotInterested && (
        <button
          type="button"
          onClick={onNotInterested}
          disabled={feedbackLoading}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <EyeOff className="h-4 w-4" />
          Not interested in this post
        </button>
      )}
      {onEditorialPreference && (
        <>
          <button
            type="button"
            onClick={() => onEditorialPreference('reduce')}
            disabled={Boolean(editorialAction)}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <UserMinus className="h-4 w-4" />
            Show fewer posts from this author
          </button>
          <button
            type="button"
            onClick={() => onEditorialPreference('mute')}
            disabled={Boolean(editorialAction)}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <EyeOff className="h-4 w-4" />
            Hide this author
          </button>
          <button
            type="button"
            onClick={() => onEditorialPreference('block')}
            disabled={Boolean(editorialAction)}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Ban className="h-4 w-4" />
            Block this account
          </button>
        </>
      )}
      {onReportMessage && (
        <button
          type="button"
          onClick={onReportMessage}
          disabled={Boolean(editorialAction)}
          className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <Flag className="h-4 w-4" />
          Report this post
        </button>
      )}
    </div>
  );
};

export default PostOptionsMenu;
