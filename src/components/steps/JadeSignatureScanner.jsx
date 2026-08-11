import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader, ScanLine, X } from 'lucide-react';

const JadeSignatureScanner = ({ onDecoded, onClose }) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const acceptedRef = useRef(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [manualValue, setManualValue] = useState('');

  const stopScanner = () => {
    controlsRef.current?.stop?.();
    controlsRef.current = null;
  };

  const acceptValue = async (value) => {
    if (acceptedRef.current || !value) return;
    try {
      acceptedRef.current = true;
      await onDecoded?.(value);
      stopScanner();
    } catch (scanError) {
      acceptedRef.current = false;
      setError(scanError.message || 'This QR code is not a valid Jade signature.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100 });
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (result?.getText) acceptValue(result.getText());
        });
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (!cancelled) setError('Camera unavailable. Allow camera access or paste the signature shown by Jade.');
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
          <ScanLine className="h-4 w-4 text-emerald-400" />
          Scan Jade signature
        </div>
        <button type="button" onClick={onClose} aria-label="Close Jade scanner" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
            <Loader className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-emerald-400/80" />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">Show the signature QR displayed by Jade to this camera.</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <details className="mt-3 text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold hover:text-white">Paste the signature instead</summary>
        <div className="mt-2 flex gap-2">
          <input
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder="Base64 signature"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white outline-none"
          />
          <button type="button" aria-label="Use pasted Jade signature" onClick={() => acceptValue(manualValue)} className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-950">
            <Camera className="h-4 w-4" />
          </button>
        </div>
      </details>
    </div>
  );
};

export default JadeSignatureScanner;

