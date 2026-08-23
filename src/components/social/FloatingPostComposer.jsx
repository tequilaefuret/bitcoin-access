import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import PostComposer from './PostComposer';

const FloatingPostComposer = ({ onPublish, isPublishing, ...composerProps }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPublishing) setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPublishing, open]);

  const publishAndClose = async () => {
    const published = await onPublish?.();
    if (published) setOpen(false);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Create a post"
          className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-amber-300 text-slate-950 shadow-[0_18px_55px_rgba(0,0,0,0.55),0_0_34px_rgba(252,211,77,0.24)] transition hover:-translate-y-1 hover:bg-amber-200 focus:outline-none focus:ring-4 focus:ring-amber-300/25 md:bottom-8 md:right-8 md:h-16 md:w-16"
        >
          <Plus className="h-7 w-7" />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[70] bg-[#07080c] md:flex md:items-center md:justify-center md:bg-black/75 md:p-6 md:backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPublishing) setOpen(false);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="new-post-title" className="flex h-full w-full flex-col overflow-y-auto bg-[#07080c] p-4 text-white md:h-auto md:max-h-[90vh] md:max-w-[760px] md:rounded-[2rem] md:border md:border-white/10 md:bg-[#0d0f14] md:p-5 md:shadow-[0_32px_100px_rgba(0,0,0,0.72)]">
            <header className="mb-4 flex items-center justify-between gap-4 px-1 py-1">
              <div>
                <h2 id="new-post-title" className="mt-1 text-xl font-black tracking-[-0.03em]">New post</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={isPublishing} aria-label="Close post composer" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/50 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </header>
            <PostComposer
              {...composerProps}
              onPublish={publishAndClose}
              isPublishing={isPublishing}
              autoFocus
              className="md:rounded-[1.5rem]"
            />
          </section>
        </div>
      )}
    </>
  );
};

export default FloatingPostComposer;
