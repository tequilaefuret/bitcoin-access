import React, { useEffect, useRef } from 'react';
import { Loader, Send } from 'lucide-react';
import {
  MessagePhotoPickerButton,
  MessagePhotoPreviews,
} from './MessagePhotoAttachments';

const PostComposer = ({
  messageContent,
  onMessageContentChange,
  onPublish,
  isPublishing,
  actionLoading,
  avatarUrl = '',
  photos = [],
  onPhotosSelected,
  onRemovePhoto,
  isOptimizingPhotos = false,
  autoFocus = false,
  className = '',
}) => {
  const textareaRef = useRef(null);
  const charCount = messageContent.replace(/\n/g, '').length;
  const canPublish = Boolean(messageContent.trim() || photos.length > 0);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  return (
    <section className={`relative overflow-hidden rounded-[1.6rem] border border-amber-200/15 bg-[#101218] bg-[linear-gradient(135deg,rgba(252,211,77,0.09),rgba(255,255,255,0.035)_52%,rgba(249,115,22,0.06))] shadow-[0_20px_60px_-42px_rgba(252,211,77,0.38)] ${className}`}>
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-amber-300/10 blur-3xl" aria-hidden="true" />
      <div className="flex gap-3 p-4 sm:p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-sm font-black text-slate-950">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Your profile" className="h-full w-full object-cover" />
          ) : 'Y'}
        </span>
        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={messageContent}
            onChange={(event) => onMessageContentChange(event.target.value)}
            placeholder="Share something new..."
            maxLength={1000}
            rows={3}
            className="w-full resize-none bg-transparent pt-2 text-base leading-7 text-white outline-none placeholder:text-white/25 sm:text-lg"
          />
          <MessagePhotoPreviews
            photos={photos}
            onRemovePhoto={onRemovePhoto}
            disabled={isPublishing}
            large
          />
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <div className="flex min-w-0 items-center gap-3">
              <MessagePhotoPickerButton
                photos={photos}
                onPhotosSelected={onPhotosSelected}
                isOptimizing={isOptimizingPhotos}
                disabled={isPublishing}
              />
              <span className={`whitespace-nowrap text-xs font-medium ${charCount > 900 ? 'text-amber-300' : 'text-white/30'}`}>{charCount} / 1000</span>
            </div>
            <button type="button" onClick={onPublish} disabled={isPublishing || actionLoading || isOptimizingPhotos || !canPublish} className="inline-flex items-center gap-2 rounded-full bg-amber-300 px-5 py-2.5 text-sm font-extrabold text-slate-950 transition hover:-translate-y-0.5 hover:bg-amber-200 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40">
              {isPublishing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PostComposer;
