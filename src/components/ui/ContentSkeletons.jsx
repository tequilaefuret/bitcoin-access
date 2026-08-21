import React from 'react';
import DanausMark from '../layout/DanausMark';

const Bone = ({ className = '' }) => (
  <div className={`rounded-full bg-white/10 ${className}`} />
);

const SkeletonStatus = ({ label, children, className = '', pulse = true }) => (
  <div role="status" aria-label={label} className={className}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className={pulse ? 'animate-pulse' : ''}>
      {children}
    </div>
  </div>
);

export const MessageCardSkeleton = ({ compact = false }) => (
  <SkeletonStatus
    label="Loading post"
    className="rounded-[1.5rem] border border-white/[0.08] bg-[#11131a] p-4"
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
      className="rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] p-4"
    >
      <Bone className="h-3 w-24" />
      <Bone className="mt-3 h-6 w-40" />
      <div className="mt-5 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-2xl border border-white/[0.08] p-4">
            <Bone className="h-3 w-20" />
            <Bone className="mt-3 h-5 w-4/5" />
            <Bone className="mt-3 h-3 w-full" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
    <SkeletonStatus
      label="Loading Opinion feed"
      className="rounded-[1.75rem] border border-white/[0.08] bg-[#11131a] p-6"
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
        <div key={item} className="rounded-2xl border border-white/[0.08] p-4">
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
  <SkeletonStatus label={label} pulse={false} className="mx-auto w-full max-w-md py-6 text-center">
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-8 shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="relative mx-auto h-16 w-16" aria-hidden="true">
        <DanausMark className="absolute inset-0 h-full w-full text-white/12" />
        <div className="danaus-antenna-fill absolute inset-0 overflow-hidden">
          <DanausMark className="h-full w-full text-amber-300 drop-shadow-[0_0_12px_rgba(252,211,77,0.35)]" />
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">Getting you there</h1>
      <p className="mt-2 text-sm leading-6 text-white/45">Verifying your private session and preparing your feed.</p>
      <div className="mx-auto mt-7 h-1.5 max-w-[220px] overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-amber-300 to-orange-400" />
      </div>
    </div>
  </SkeletonStatus>
);
