import React from 'react';

const PostMediaGallery = ({ media = [], compact = false }) => {
  const photos = Array.isArray(media) ? media.slice(0, 3).filter((item) => item?.url) : [];
  if (photos.length === 0) return null;

  const gridClass = photos.length === 1
    ? 'grid-cols-1'
    : 'grid-cols-2';

  return (
    <div className={`mb-3 mt-3 grid overflow-hidden rounded-2xl border border-white/[0.08] bg-black/20 ${gridClass} ${photos.length > 1 ? 'gap-0.5' : ''}`}>
      {photos.map((photo, index) => (
        <a
          key={`${photo.url}-${index}`}
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={`${photos.length === 3 && index === 0 ? 'row-span-2' : ''} block overflow-hidden bg-black/25`}
          aria-label={`Open photo ${index + 1} of ${photos.length}`}
        >
          <img
            src={photo.url}
            alt={`Post attachment ${index + 1}`}
            width={photo.width || undefined}
            height={photo.height || undefined}
            loading="lazy"
            decoding="async"
            className={`w-full object-cover transition duration-300 hover:scale-[1.015] ${
              photos.length === 1
                ? compact ? 'max-h-72' : 'max-h-[34rem]'
                : photos.length === 3 && index === 0
                  ? compact ? 'h-44' : 'h-64 sm:h-80'
                  : compact ? 'h-[87px]' : 'h-[127px] sm:h-[159px]'
            }`}
          />
        </a>
      ))}
    </div>
  );
};

export default PostMediaGallery;
