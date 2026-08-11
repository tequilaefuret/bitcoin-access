const QR_CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

const getVideoTrack = (video) => video?.srcObject?.getVideoTracks?.()[0] || null;

const createQrReader = async () => {
  const [{ BrowserQRCodeReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserQRCodeReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 80,
  });
};

const improveCameraFocus = async (track) => {
  try {
    const capabilities = track?.getCapabilities?.() || {};
    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch {
    // Autofocus constraints are optional and vary between mobile browsers.
  }
};

const readZoomCapability = (track) => {
  try {
    const capability = track?.getCapabilities?.().zoom;
    if (!capability || !Number.isFinite(capability.min) || !Number.isFinite(capability.max)) return null;
    if (capability.max <= capability.min) return null;
    const settings = track.getSettings?.() || {};
    return {
      min: capability.min,
      max: capability.max,
      step: capability.step || 0.1,
      value: Number.isFinite(settings.zoom) ? settings.zoom : capability.min,
    };
  } catch {
    return null;
  }
};

const startNativeDetector = async (video, onText) => {
  if (typeof window === 'undefined' || typeof window.BarcodeDetector !== 'function') return () => {};

  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    if (Array.isArray(supported) && !supported.includes('qr_code')) return () => {};
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    let active = true;
    let timer = null;
    let detecting = false;

    const detect = async () => {
      if (!active) return;
      if (!detecting && video.readyState >= 2) {
        detecting = true;
        try {
          const codes = await detector.detect(video);
          codes.forEach((code) => {
            if (code.rawValue) onText(code.rawValue);
          });
        } catch {
          // ZXing remains active when the optional native detector cannot read a frame.
        } finally {
          detecting = false;
        }
      }
      if (active) timer = window.setTimeout(detect, 180);
    };

    detect();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  } catch {
    return () => {};
  }
};

export async function startQrCamera({ video, onText }) {
  if (!video) throw new Error('The camera preview is not ready.');
  const reader = await createQrReader();
  const controls = await reader.decodeFromConstraints(QR_CAMERA_CONSTRAINTS, video, (result) => {
    if (result?.getText) onText(result.getText());
  });
  const track = getVideoTrack(video);
  await improveCameraFocus(track);
  const stopNativeDetector = await startNativeDetector(video, onText);
  const settings = track?.getSettings?.() || {};
  let stopped = false;

  return {
    zoom: readZoomCapability(track),
    resolution: settings.width && settings.height ? `${settings.width} × ${settings.height}` : '',
    async setZoom(value) {
      if (!track || !Number.isFinite(value)) return;
      await track.applyConstraints({ advanced: [{ zoom: value }] });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stopNativeDetector();
      controls.stop();
    },
  };
}

export async function decodeQrImageFile(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Select a photo containing one Jade QR frame.');
  if (file.size > 15 * 1024 * 1024) throw new Error('The QR photo must be smaller than 15 MB.');
  const reader = await createQrReader();
  const imageUrl = URL.createObjectURL(file);
  try {
    const result = await reader.decodeFromImageUrl(imageUrl);
    const value = result?.getText?.();
    if (!value) throw new Error('No QR code was found in this photo.');
    return value;
  } catch (error) {
    if (error?.message === 'No QR code was found in this photo.') throw error;
    throw new Error('No QR code was found in this photo. Move closer, avoid reflections and try again.');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
