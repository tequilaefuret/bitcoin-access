import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createPsbtUrEncoder } from '../../lib/bcUrPsbt';

const AnimatedPsbtQr = ({ psbtBase64 }) => {
  const encoder = useMemo(() => createPsbtUrEncoder(psbtBase64), [psbtBase64]);
  const [part, setPart] = useState(() => encoder.nextPart());
  const [frame, setFrame] = useState(1);

  useEffect(() => {
    setPart(encoder.nextPart());
    setFrame(1);
    const interval = setInterval(() => {
      setPart(encoder.nextPart());
      setFrame((current) => current + 1);
    }, 280);
    return () => clearInterval(interval);
  }, [encoder]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
      <div className="mx-auto w-fit rounded-2xl bg-white p-2 ring-1 ring-slate-200">
        <QRCodeSVG
          value={part}
          size={256}
          level="L"
          bgColor="#ffffff"
          fgColor="#0f172a"
          includeMargin
        />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-800">Scan with the signing device</p>
      <p className="mt-1 text-xs text-slate-500">
        Animated BC-UR · {encoder.fragmentsLength} source frames · frame {frame}
      </p>
    </div>
  );
};

export default AnimatedPsbtQr;
