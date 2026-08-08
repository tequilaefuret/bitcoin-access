import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader, ScanLine, X } from 'lucide-react';
import { createPsbtUrDecoder } from '../../lib/bcUrPsbt';

const BcUrPsbtScanner = ({ onDecoded, onClose }) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const decoderRef = useRef(createPsbtUrDecoder());
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [manualPart, setManualPart] = useState('');

  const stopScanner = () => {
    controlsRef.current?.stop?.();
    controlsRef.current = null;
  };

  const receivePart = (part) => {
    try {
      const result = decoderRef.current.receivePart(part);
      setProgress(result.progress);
      setError('');
      if (result.complete) {
        stopScanner();
        onDecoded?.(result.psbtBase64);
      }
    } catch (scanError) {
      setError(scanError.message || 'Unable to decode this QR code.');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 80 });
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (result?.getText) receivePart(result.getText());
          },
        );
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch (cameraError) {
        if (!cancelled) setError('Camera unavailable. Allow camera access or import the signed PSBT file.');
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="h-4 w-4 text-orange-400" />
          Scan signed BC-UR
        </div>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
            <Loader className="h-6 w-6 animate-spin text-orange-400" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-orange-400/80" />
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-orange-400 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">Keep the animated QR inside the frame · {progress}% received</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      <details className="mt-3 text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold hover:text-white">Enter a UR fragment manually</summary>
        <div className="mt-2 flex gap-2">
          <input
            value={manualPart}
            onChange={(event) => setManualPart(event.target.value)}
            placeholder="ur:crypto-psbt/..."
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white outline-none"
          />
          <button type="button" onClick={() => receivePart(manualPart)} className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-950">
            <Camera className="h-4 w-4" />
          </button>
        </div>
      </details>
    </div>
  );
};

export default BcUrPsbtScanner;
