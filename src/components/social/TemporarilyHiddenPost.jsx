import React from 'react';
import { EyeOff, RotateCcw } from 'lucide-react';

const TemporarilyHiddenPost = ({ onUndo }) => (
  <div
    role="status"
    className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.025] px-5 py-4 text-white/40"
  >
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      <EyeOff className="h-4 w-4" />
      Post hidden
    </span>
    <button
      type="button"
      onClick={onUndo}
      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-amber-200"
    >
      <RotateCcw className="h-4 w-4" />
      Undo
    </button>
  </div>
);

export default TemporarilyHiddenPost;
