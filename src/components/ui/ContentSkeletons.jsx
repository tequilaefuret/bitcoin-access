import React from 'react';

const Bone = ({ className = '' }) => (
  <div className={`rounded-full bg-slate-200/90 ${className}`} />
);

const SkeletonStatus = ({ label, children, className = '' }) => (
  <div role="status" aria-label={label} className={className}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="animate-pulse">
      {children}
    </div>
  </div>
);

export const MessageCardSkeleton = ({ compact = false }) => (
  <SkeletonStatus
    label="Loading post"
    className="rounded-2xl border border-slate-100 bg-white p-4"
  >
    <div className="flex items-center justify-between gap-4">
      <Bone className="h-4 w-28" />
      <Bone className="h-3 w-16" />
    </div>
    <div className="mt-5 space-y-2.5">
      <Bone className="h-3 w-full" />
      <Bone className="h-3 w-11/12" />
      {!compact && <Bone className="h-3 w-3/5" />}
    </div>
    {!compact && (
      <div className="mt-5 flex gap-5">
        <Bone className="h-7 w-20" />
        <Bone className="h-7 w-12" />
        <Bone className="h-7 w-12" />
      </div>
    )}
  </SkeletonStatus>
);

export const FeedSkeleton = ({ count = 3, compact = false, className = '' }) => (
  <div className={`space-y-4 ${className}`}>
    {Array.from({ length: count }, (_, index) => (
      <MessageCardSkeleton key={index} compact={compact} />
    ))}
  </div>
);

export const OpinionFeedSkeleton = () => (
  <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
    <SkeletonStatus
      label="Loading Opinion topics"
      className="rounded-[1.75rem] border border-slate-200 bg-white p-4"
    >
      <Bone className="h-3 w-24" />
      <Bone className="mt-3 h-6 w-40" />
      <div className="mt-5 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-100 p-4">
            <Bone className="h-3 w-20" />
            <Bone className="mt-3 h-5 w-4/5" />
            <Bone className="mt-3 h-3 w-full" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
    <SkeletonStatus
      label="Loading Opinion feed"
      className="rounded-[1.75rem] border border-slate-200 bg-white p-6"
    >
      <Bone className="h-3 w-24" />
      <Bone className="mt-4 h-9 w-3/5" />
      <Bone className="mt-4 h-4 w-4/5" />
      <FeedSkeleton count={3} className="mt-8" />
    </SkeletonStatus>
  </div>
);

export const ProfileSkeleton = () => (
  <SkeletonStatus label="Loading profile" className="space-y-7 py-3">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rounded-2xl border border-slate-100 p-4">
          <Bone className="h-3 w-20" />
          <Bone className="mt-4 h-7 w-28" />
        </div>
      ))}
    </div>
    <div className="flex gap-2">
      <Bone className="h-10 w-24" />
      <Bone className="h-10 w-24" />
      <Bone className="h-10 w-24" />
    </div>
    <FeedSkeleton count={3} />
  </SkeletonStatus>
);

export const ListSkeleton = ({ label = 'Loading content', count = 3, className = '' }) => (
  <SkeletonStatus label={label} className={`space-y-3 ${className}`}>
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="rounded-2xl border border-slate-100 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Bone className="h-4 w-2/5" />
            <Bone className="mt-3 h-3 w-3/5" />
          </div>
          <Bone className="h-9 w-20 shrink-0" />
        </div>
      </div>
    ))}
  </SkeletonStatus>
);

export const ScreenSkeleton = ({ label = 'Loading page' }) => (
  <SkeletonStatus label={label} className="mx-auto w-full max-w-4xl space-y-5 py-6">
    <div className="rounded-[2rem] border border-white/40 bg-white/80 p-6 shadow-xl">
      <Bone className="h-3 w-28" />
      <Bone className="mt-4 h-9 w-2/3" />
      <Bone className="mt-4 h-4 w-1/2" />
    </div>
    <FeedSkeleton count={3} />
  </SkeletonStatus>
);
