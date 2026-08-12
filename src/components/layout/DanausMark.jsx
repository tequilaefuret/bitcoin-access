import React from 'react';

const DanausMark = ({ className = 'h-5 w-5', title }) => (
  <svg viewBox="0 0 36 36" className={className} fill="none" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
    {title && <title>{title}</title>}
    <path d="M15.1 27.5c0-6-1-11.1-4-16" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" />
    <path d="M20.9 27.5c0-6 1-11.1 4-16" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" />
    <circle cx="10.7" cy="9.2" r="2.25" fill="currentColor" />
    <circle cx="25.3" cy="9.2" r="2.25" fill="currentColor" />
  </svg>
);

export default DanausMark;
