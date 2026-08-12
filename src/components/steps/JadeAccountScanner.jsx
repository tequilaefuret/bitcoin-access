import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader, ScanLine, X } from 'lucide-react';
import { createJadeAccountUrDecoder } from '../../lib/jadeQr';
import { decodeQrImageFile, startQrCamera } from '../../lib/qrCamera';

const JadeAccountScanner = ({ onDecoded, onClose }) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const decoderRef = useRef(createJadeAccountUrDecoder());
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [manualPart, setManualPart] = useState('');
  const [recognizedFrames, setRecognizedFrames] = useState(0);
  const [sourceFrames, setSourceFrames] = useState(0);
  const [cameraResolution, setCameraResolution] = useState('');
  const [zoom, setZoom] = useState(null);
  const [noQrDetected, setNoQrDetected] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const stopScanner = () => {
    controlsRef.current?.stop?.();
    controlsRef.current = null;
  };

  const receivePart = (part) => {
    try {
      setNoQrDetected(false);
      const result = decoderRef.current.receivePart(part);
      setProgress(result.progress);
      if (result.sourceFrames) setSourceFrames(result.sourceFrames);
      if (!result.duplicate) setRecognizedFrames((count) => count + 1);
      setError('');
      if (result.complete) {
        stopScanner();
        onDecoded?.(result);
      }
    } catch (scanError) {
      setError(scanError.message || 'Unable to decode this Jade account QR.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    let diagnosticTimer = null;
    const start = async () => {
      try {
        const controls = await startQrCamera({
          video: videoRef.current,
          onText: receivePart,
        });
        if (cancelled) controls.stop();
        else {
          controlsRef.current = controls;
          setCameraResolution(controls.resolution);
          setZoom(controls.zoom);
          diagnosticTimer = window.setTimeout(() => setNoQrDetected(true), 6000);
        }
      } catch {
        if (!cancelled) setError('Camera unavailable. Allow camera access and try again.');
      } finally {
        if (!cancelled) setStarting(false);
      }
    };
    start();
    return () => {
      cancelled = true;
      if (diagnosticTimer) window.clearTimeout(diagnosticTimer);
      stopScanner();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="h-4 w-4 text-emerald-400" />
          Scan Jade animated xpub
        </div>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {starting && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80"><Loader className="h-6 w-6 animate-spin text-emerald-400" /></div>}
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-emerald-400/80" />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Keep the whole QR, including its white border, inside the frame · {progress}% received
        {recognizedFrames > 0 ? ` · ${recognizedFrames} unique QR frame${recognizedFrames > 1 ? 's' : ''} recognized` : ''}
        {sourceFrames > 0 ? ` · ${sourceFrames} frame${sourceFrames > 1 ? 's' : ''} in one Jade animation cycle` : ''}
        {cameraResolution ? ` · ${cameraResolution}` : ''}
      </p>
      {zoom && (
        <label className="mt-3 grid gap-1 text-xs text-slate-300">
          Camera zoom: {Number(zoom.value).toFixed(1)}×
          <input
            type="range"
            min={zoom.min}
            max={zoom.max}
            step={zoom.step}
            value={zoom.value}
            onChange={async (event) => {
              const value = Number(event.target.value);
              setZoom((current) => ({ ...current, value }));
              try {
                await controlsRef.current?.setZoom?.(value);
              } catch {
                setError('This camera could not apply the selected zoom.');
              }
            }}
            className="w-full accent-emerald-400"
          />
        </label>
      )}
      {noQrDetected && recognizedFrames === 0 && !error && (
        <p className="mt-3 rounded-lg bg-amber-400/15 px-3 py-2 text-xs leading-5 text-amber-200">
          No QR frame has been recognized. Increase Jade’s screen brightness, clean both lenses, avoid reflections, and move Jade slowly between 10 and 20 cm from the phone. Keep the white border visible; use the zoom control if offered.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {progress === 99 && !error && (
        <p className="mt-3 rounded-lg bg-blue-400/15 px-3 py-2 text-xs leading-5 text-blue-100">
          Almost complete. Animated BC-UR intentionally pauses at 99% until a final useful frame arrives; keep scanning until the result is imported.
        </p>
      )}
      <div className="mt-3 rounded-lg border border-white/15 bg-white/5 p-3">
        <p className="text-xs leading-5 text-slate-300">
          If live scanning stays at 0%, photograph one Jade frame at full resolution. Wait for Jade’s QR to change between photos. {sourceFrames > 0
            ? `This export has ${sourceFrames} frames in one complete animation cycle: take at most ${sourceFrames} distinct photos, one per frame, then restart the scan if it has not imported.`
            : 'After the first readable frame, the exact number of photos for one complete animation cycle will appear above.'}
        </p>
        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950">
          {photoBusy ? <Loader className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {photoBusy ? 'Reading photo...' : 'Photograph one QR frame'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={photoBusy}
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                setPhotoBusy(true);
                setError('');
                receivePart(await decodeQrImageFile(file));
              } catch (photoError) {
                setError(photoError.message || 'Unable to read this QR photo.');
              } finally {
                setPhotoBusy(false);
              }
            }}
          />
        </label>
      </div>
      <details className="mt-3 text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold hover:text-white">Enter a UR fragment manually</summary>
        <div className="mt-2 flex gap-2">
          <input value={manualPart} onChange={(event) => setManualPart(event.target.value)} placeholder="ur:crypto-account/..." className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white outline-none" />
          <button type="button" onClick={() => receivePart(manualPart)} aria-label="Add QR fragment" className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-950"><Camera className="h-4 w-4" /></button>
        </div>
      </details>
    </div>
  );
};

export default JadeAccountScanner;
