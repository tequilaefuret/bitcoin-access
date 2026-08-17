import React, { useState } from 'react';
import { TEXT_PREVIEW_LENGTH } from '../../features/social/messagePresentation';

const ExpandableText = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const safeText = text || '';
  const isLong = safeText.length > TEXT_PREVIEW_LENGTH;
  const visibleText = expanded || !isLong
    ? safeText
    : `${safeText.slice(0, TEXT_PREVIEW_LENGTH).trim()}...`;

  return (
    <div className="mb-3 text-white/70">
      <p className="whitespace-pre-wrap text-[15px] leading-6">{visibleText}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-xs font-semibold text-amber-300 hover:text-amber-200"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
};

export default ExpandableText;
