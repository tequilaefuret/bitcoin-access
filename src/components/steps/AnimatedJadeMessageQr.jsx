import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createJadeMessageUrEncoder } from '../../lib/jadeQr';

const DEFAULT_FRAME_DELAY = 1600;

const AnimatedJadeMessageQr = ({ payload }) => {
  const sequence = useMemo(() => {
    const encoder = createJadeMessageUrEncoder(payload);
    const parts = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart().toUpperCase());
    return { parts, fragmentsLength: encoder.fragmentsLength };
  }, [payload]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [frameDelay, setFrameDelay] = useState(DEFAULT_FRAME_DELAY);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setFrameIndex(0);
    setPaused(false);
  }, [sequence]);

  useEffect(() => {
    if (paused || sequence.parts.length < 2) return undefined;
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % sequence.parts.length);
    }, frameDelay);
    return () => clearInterval(interval);
  }, [frameDelay, paused, sequence]);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const selectFrame = (direction) => {
    setPaused(true);
    setFrameIndex((current) => (current + direction + sequence.parts.length) % sequence.parts.length);
  };

  const part = sequence.parts[frameIndex];

  return (
    <div className={expanded
      ? 'fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-white p-3 text-center'
      : 'rounded-2xl border border-slate-200 bg-white p-3 text-center sm:p-4'}>
      <div className="mx-auto w-fit max-w-full bg-white">
        <QRCodeSVG
          value={part}
          size={expanded ? 410 : 328}
          level="L"
          bgColor="#ffffff"
          fgColor="#000000"
          marginSize={4}
          shapeRendering="crispEdges"
          className={expanded ? 'block h-auto max-h-[76vh] max-w-[94vw]' : 'block h-auto max-w-full'}
        />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-800">Keep Jade pointed at this low-density QR</p>
      <p className="mt-1 text-xs text-slate-500">
        Jade BC-UR · {sequence.fragmentsLength} source frames · frame {frameIndex + 1}/{sequence.fragmentsLength} · {(frameDelay / 1000).toFixed(1)}s per frame
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => selectFrame(-1)} aria-label="Previous Jade QR frame" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setPaused((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={() => selectFrame(1)} aria-label="Next Jade QR frame" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50">
          <ChevronRight className="h-4 w-4" />
        </button>
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
          Speed
          <select value={frameDelay} onChange={(event) => setFrameDelay(Number(event.target.value))} className="bg-white text-slate-900 outline-none">
            <option value={2400}>Very slow</option>
            <option value={1600}>Slow</option>
            <option value={1000}>Normal</option>
          </select>
        </label>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {expanded ? 'Exit full screen' : 'Enlarge QR'}
        </button>
      </div>
      <p className="mx-auto mt-3 max-w-lg text-xs leading-5 text-slate-500">
        Use Enlarge QR and maximum phone brightness. If Jade still misses frames, choose Very slow or pause and advance one frame at a time after Jade’s progress changes.
      </p>
    </div>
  );
};

export default AnimatedJadeMessageQr;
