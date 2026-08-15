import React from 'react';
import { EyeOff, RotateCcw } from 'lucide-react';

const TemporarilyHiddenPost = ({ onUndo }) => (
  <div
    role="status"
    className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-slate-600"
  >
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      <EyeOff className="h-4 w-4" />
      Post hidden
    </span>
    <button
      type="button"
      onClick={onUndo}
      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 transition hover:ring-amber-400"
    >
      <RotateCcw className="h-4 w-4" />
      Undo
    </button>
  </div>
);

export default TemporarilyHiddenPost;
