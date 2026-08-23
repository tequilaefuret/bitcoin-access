import React, { lazy, Suspense, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileKey2,
  FileSignature,
  Loader,
  PlugZap,
  QrCode,
  ScanLine,
  Upload,
} from 'lucide-react';
import { ListSkeleton } from '../ui/ContentSkeletons';
import { psbtBase64ToBlob, psbtFileToBase64 } from '../../lib/psbtFiles';
import { copyToClipboard } from '../../lib/clipboard';
import ConnectionMethodHelp from './ConnectionMethodHelp';

const AnimatedPsbtQr = lazy(() => import('./AnimatedPsbtQr'));
const AnimatedJadeMessageQr = lazy(() => import('./AnimatedJadeMessageQr'));
const BcUrPsbtScanner = lazy(() => import('./BcUrPsbtScanner'));
const JadeAccountScanner = lazy(() => import('./JadeAccountScanner'));
const JadeSignatureScanner = lazy(() => import('./JadeSignatureScanner'));

const TrezorMark = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 28.8 41.9" aria-hidden="true" className={className} fill="currentColor">
    <path d="M24.6 9.7C24.6 4.4 20 0 14.4 0S4.2 4.4 4.2 9.7v3.1H0v22.3l14.4 6.8 14.4-6.8V12.9h-4.2V9.7ZM9.4 9.7c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5v3.1h-10V9.7ZM23 31.5l-8.6 4-8.6-4V18.1H23v13.4Z" />
  </svg>
);

const LedgerMark = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
    <path d="M3 3h7v2H5v5H3V3Zm11 0h7v7h-2V5h-5V3ZM3 14h2v5h5v2H3v-7Zm16 0h2v7h-7v-2h5v-5ZM8 8h8v8H8V8Z" />
  </svg>
);

const JadeMark = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
    <path d="m12 2.75 7.5 5.4-2.85 9.1L12 21.25l-4.65-4-2.85-9.1 7.5-5.4Z" />
    <path d="m4.5 8.15 7.5 3.7 7.5-3.7M12 2.75v9.1m-4.65 5.4L12 11.85l4.65 5.4" />
  </svg>
);

const QrLoading = () => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <ListSkeleton label="Loading QR tools" count={1} />
  </div>
);

const downloadBlob = (fileName, blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadJson = (fileName, payload) => {
  downloadBlob(fileName, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
};

const AuthProofPanel = ({
  authRequest,
  authHint,
  manualAddress = '',
  manualSignature = '',
  onManualAddressChange,
  onManualSignatureChange,
  onGenerateProof,
  onSubmitManualProof,
  isManualDesktop = false,
  selectedPersonaId,
  multisigWitnessScript,
  onMultisigWitnessScriptChange,
  signedPsbt,
  onSignedPsbtChange,
  offlineProofFormat,
  onOfflineProofFormatChange,
  descriptorInput,
  onDescriptorInputChange,
  descriptorBranch,
  onDescriptorBranchChange,
  descriptorIndex,
  onDescriptorIndexChange,
  descriptorInfo,
  descriptorError,
  onImportDescriptor,
  walletConnected = false,
  canDirectSign = false,
  onConnectDirectSigner,
  onSignPsbtDirect,
  isDirectSigning = false,
  onConnectLedger,
  ledgerAccount = 0,
  onLedgerAccountChange,
  ledgerStatus = '',
  ledgerBusy = false,
  ledgerUsbAvailability = { supported: false, reason: 'Direct Ledger connection is unavailable.' },
  onConnectTrezor,
  trezorAccount = 0,
  onTrezorAccountChange,
  trezorStatus = '',
  trezorBusy = false,
  trezorUsbAvailability = { supported: false, reason: 'Direct Trezor connection is unavailable.' },
  onConnectJade,
  onPrepareJadeQr,
  onAcceptJadeAccountQr,
  onAcceptJadeQrSignature,
  onSubmitJadeQrProof,
  jadeAccount = 0,
  onJadeAccountChange,
  jadeStatus = '',
  jadeBusy = false,
  jadeUsbAvailability = { supported: false, reason: 'Direct Jade connection is unavailable.' },
  jadeQrPayload = '',
  jadeQrPath = '',
  jadeQrAccountInfo = null,
  mobileDevice = false,
  hardwareMethod = 'direct',
  onHardwareMethodChange,
}) => {
  const [fileError, setFileError] = useState('');
  const [showAnimatedQr, setShowAnimatedQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showJadeScanner, setShowJadeScanner] = useState(false);
  const [showJadeAccountScanner, setShowJadeAccountScanner] = useState(false);
  const [copiedAction, setCopiedAction] = useState('');
  const isMultisig = selectedPersonaId === 'cold_multisig';
  const isHardware = selectedPersonaId === 'cold_single_seed';
  const usesTrezorSuite = trezorUsbAvailability.mode === 'suite-app';
  const usesLedgerWallet = ledgerUsbAvailability.mode === 'wallet-app';
  const usesPsbt = authRequest?.proofFormat === 'bip322-psbt'
    || (authRequest == null && !isManualDesktop && (isMultisig || offlineProofFormat === 'psbt'));

  useEffect(() => {
    if (isHardware && !authRequest) onHardwareMethodChange?.('direct');
  }, [isHardware, selectedPersonaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectHardwareMethod = (method) => {
    onHardwareMethodChange?.(method);
    if (method === 'message' || method === 'psbt') onOfflineProofFormatChange(method);
  };

  const importPsbt = async (file) => {
    if (!file) return;
    try {
      setFileError('');
      onSignedPsbtChange(await psbtFileToBase64(file));
    } catch (error) {
      setFileError(error.message || 'Unable to read this PSBT.');
    }
  };

  const importDescriptorFile = async (file) => {
    if (!file) return;
    try {
      setFileError('');
      const value = await file.text();
      onDescriptorInputChange(value);
      await onImportDescriptor(value);
    } catch (error) {
      setFileError(error.message || 'Unable to read this wallet policy.');
    }
  };

  const useDescriptor = async () => {
    try {
      setFileError('');
      await onImportDescriptor(descriptorInput);
    } catch {
      // The hook exposes the precise validation error next to the descriptor.
    }
  };

  const acceptScannedPsbt = (value) => {
    onSignedPsbtChange(value);
    setShowScanner(false);
    setFileError('');
  };

  const copyWithFeedback = async (action, value) => {
    try {
      setFileError('');
      if (!await copyToClipboard(value)) throw new Error('Copy is unavailable in this browser.');
      setCopiedAction(action);
      setTimeout(() => setCopiedAction(''), 1800);
    } catch (error) {
      setFileError(error.message || 'Unable to copy this value.');
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      {!authRequest ? (
        <div className="grid gap-4">
          {isHardware && (
            <div className="rounded-xl bg-slate-200/70 p-1">
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => selectHardwareMethod('direct')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    hardwareMethod === 'direct' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Direct connection
                </button>
                <button
                  type="button"
                  onClick={() => selectHardwareMethod('message')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    hardwareMethod === 'message' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Message signature
                </button>
                <button
                  type="button"
                  onClick={() => selectHardwareMethod('psbt')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    hardwareMethod === 'psbt' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  PSBT
                </button>
              </div>
            </div>
          )}

          {isHardware && hardwareMethod === 'direct' && (
            <section className="grid min-w-0 gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
              <div>
                <h3 className="text-sm font-bold text-slate-950">Direct connection</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">The site automatically uses a direct connection or the official wallet app supported by your device.</p>
              </div>

              <div className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span data-testid="trezor-brand-mark" className="shrink-0 rounded-xl bg-[#60E198] p-2 text-[#062D16]"><TrezorMark /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-950">Trezor</h4>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {usesTrezorSuite
                        ? 'Continue in Trezor Suite to confirm your address and sign the login message.'
                        : 'Connect your Trezor, verify the address, then sign the login message.'}
                    </p>
                  </div>
                </div>

                <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced address selection</summary>
                  <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Account
                      <input type="number" min="0" max="100" step="1" value={trezorAccount} onChange={(event) => onTrezorAccountChange?.(Number(event.target.value))} disabled={trezorBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400" />
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Chain
                      <select value={descriptorBranch} onChange={(event) => onDescriptorBranchChange(Number(event.target.value))} disabled={trezorBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400">
                        <option value={0}>Receive</option>
                        <option value={1}>Change</option>
                      </select>
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Index
                      <input type="number" min="0" max="2147483647" step="1" value={descriptorIndex} onChange={(event) => onDescriptorIndexChange(Number(event.target.value))} disabled={trezorBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400" />
                    </label>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Leave the defaults unless you intentionally use another BIP84 address.</p>
                </details>

                <button type="button" onClick={onConnectTrezor} disabled={!trezorUsbAvailability.supported || trezorBusy || ledgerBusy || jadeBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {trezorBusy ? <Loader className="h-4 w-4 animate-spin" /> : <TrezorMark className="h-4 w-4" />}
                  {trezorBusy ? 'Connecting Trezor...' : 'Connect Trezor'}
                </button>
                {trezorStatus && <p className="text-xs font-medium text-blue-700">{trezorStatus}</p>}
                {trezorUsbAvailability.reason && <p className="text-xs leading-5 text-slate-500">{trezorUsbAvailability.reason}</p>}
                <ConnectionMethodHelp
                  compact
                  guideId={usesTrezorSuite ? 'hardware-trezor-suite' : 'hardware-trezor-direct'}
                />
              </div>

              <div className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="shrink-0 rounded-xl bg-slate-950 p-2 text-white"><LedgerMark /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-950">Ledger</h4>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {usesLedgerWallet
                        ? 'Continue with Ledger Wallet through the secure wallet selector.'
                        : 'Verify your address, then approve the login message. Sign-in completes automatically.'}
                    </p>
                  </div>
                </div>
                <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced account selection</summary>
                  <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-600">
                    Account
                    <input type="number" min="0" max="100" step="1" value={ledgerAccount} onChange={(event) => onLedgerAccountChange?.(Number(event.target.value))} disabled={ledgerBusy} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400" />
                  </label>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Keep account 0 unless you intentionally created another Native SegWit Bitcoin account.</p>
                </details>
                <button type="button" onClick={onConnectLedger} disabled={!ledgerUsbAvailability.supported || ledgerBusy || trezorBusy || jadeBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {ledgerBusy ? <Loader className="h-4 w-4 animate-spin" /> : <LedgerMark className="h-4 w-4" />}
                  {ledgerBusy ? 'Connecting Ledger...' : 'Connect Ledger'}
                </button>
                {ledgerStatus && <p className="text-xs font-medium text-blue-700">{ledgerStatus}</p>}
                {ledgerUsbAvailability.reason && <p className="text-xs leading-5 text-slate-500">{ledgerUsbAvailability.reason}</p>}
                <ConnectionMethodHelp
                  compact
                  guideId={usesLedgerWallet ? 'hardware-ledger-wallet' : 'hardware-ledger-direct'}
                />
              </div>

              <div className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="shrink-0 rounded-xl bg-emerald-700 p-2 text-white"><JadeMark /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-950">Jade</h4>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">USB / QR</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Connect directly over USB, or keep a camera-equipped Jade fully air-gapped with its native message QR format.</p>
                  </div>
                </div>
                <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced Jade address selection</summary>
                  <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Account
                      <input type="number" min="0" max="100" step="1" value={jadeAccount} onChange={(event) => onJadeAccountChange?.(Number(event.target.value))} disabled={jadeBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400" />
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Chain
                      <select value={descriptorBranch} onChange={(event) => onDescriptorBranchChange(Number(event.target.value))} disabled={jadeBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400">
                        <option value={0}>Receive</option>
                        <option value={1}>Change</option>
                      </select>
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
                      Index
                      <input type="number" min="0" max="2147483647" step="1" value={descriptorIndex} onChange={(event) => onDescriptorIndexChange(Number(event.target.value))} disabled={jadeBusy} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400" />
                    </label>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Defaults to the first BIP84 receiving address: m/84'/0'/0'/0/0.</p>
                </details>
                <div className={`grid gap-2 ${mobileDevice ? '' : 'sm:grid-cols-2'}`}>
                  {!mobileDevice && (
                    <button type="button" onClick={onConnectJade} disabled={!jadeUsbAvailability.supported || jadeBusy || trezorBusy || ledgerBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {jadeBusy ? <Loader className="h-4 w-4 animate-spin" /> : <JadeMark className="h-4 w-4" />}
                      {jadeBusy ? 'Connecting Jade...' : 'Connect Jade by USB'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => selectHardwareMethod('jade-qr')}
                    disabled={jadeBusy || trezorBusy || ledgerBusy}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      mobileDevice
                        ? 'border-black bg-black text-white hover:bg-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <QrCode className="h-4 w-4" />
                    Use Jade QR
                  </button>
                </div>
                {jadeStatus && <p className="text-xs font-medium text-blue-700">{jadeStatus}</p>}
                {!mobileDevice && jadeUsbAvailability.reason && <p className="text-xs leading-5 text-slate-500">{jadeUsbAvailability.reason}</p>}
                {mobileDevice && <p className="text-xs leading-5 text-slate-500">On mobile, unlock Jade with QR PIN Unlock, then use Jade QR below.</p>}
                <ConnectionMethodHelp compact guideId={mobileDevice ? 'hardware-jade-qr' : 'hardware-jade-usb'} />
              </div>

              <p className="text-xs leading-5 text-slate-500">Never enter your seed or approve a real transaction.</p>
            </section>
          )}

          {isHardware && hardwareMethod === 'jade-qr' && (
            <section className="grid gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-emerald-700 p-2 text-white"><QrCode className="h-5 w-5" /></span>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Jade air-gapped QR</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Jade first shares a public xpub so the address can be derived automatically. No cable, transaction or PSBT is used.</p>
                </div>
              </div>
              <ol className="grid gap-1 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-xs leading-5 text-slate-700">
                <li><strong>1.</strong> On Jade Plus, choose <strong>QR Mode → QR PIN Unlock</strong>, then complete both animated QR exchanges on Blockstream’s official page.</li>
                <li><strong>2.</strong> On Jade, open <strong>Options → Wallet → Export Xpub</strong>.</li>
                <li><strong>3.</strong> Keep <strong>Native SegWit · Singlesig</strong>, then scan Jade’s animated QR below.</li>
              </ol>
              <a href="https://blkstrm.com/pn" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950">
                Open the official Blockstream QR PIN Unlock page (Jade Plus)
              </a>
              <p className="text-xs leading-5 text-slate-500">Return here without turning Jade off, then export the xpub. If QR PIN Unlock is absent, update Jade firmware or unlock it through the Blockstream app by USB/Bluetooth.</p>
              <button type="button" onClick={() => setShowJadeAccountScanner((visible) => !visible)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-bold text-emerald-800 transition hover:bg-emerald-50">
                <ScanLine className="h-4 w-4" />
                {showJadeAccountScanner ? 'Hide xpub scanner' : jadeQrAccountInfo ? 'Scan another Jade xpub' : 'Scan Jade animated xpub'}
              </button>
              {showJadeAccountScanner && (
                <Suspense fallback={<QrLoading />}>
                  <JadeAccountScanner
                    onDecoded={async (accountInfo) => {
                      await onAcceptJadeAccountQr?.(accountInfo);
                      setShowJadeAccountScanner(false);
                    }}
                    onClose={() => setShowJadeAccountScanner(false)}
                  />
                </Suspense>
              )}
              {jadeQrAccountInfo && descriptorInfo && (
                <div className="grid gap-3 rounded-xl border border-emerald-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Public Jade account imported
                  </div>
                  <div className="grid gap-1 text-xs text-slate-600">
                    <span>Path: <span className="font-mono">{jadeQrAccountInfo.accountPath}/{descriptorBranch}/{descriptorIndex}</span></span>
                    <span className="break-all">Address: <span className="font-mono text-slate-900">{descriptorInfo.address}</span></span>
                  </div>
                  <details className="rounded-lg bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced address selection</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-semibold text-slate-600">
                        Chain
                        <select value={descriptorBranch} onChange={(event) => onDescriptorBranchChange(Number(event.target.value))} disabled={jadeBusy} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900">
                          <option value={0}>Receive</option>
                          <option value={1}>Change</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-600">
                        Index
                        <input type="number" min="0" max="2147483647" step="1" value={descriptorIndex} onChange={(event) => onDescriptorIndexChange(Number(event.target.value))} disabled={jadeBusy} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" />
                      </label>
                    </div>
                  </details>
                  <button type="button" onClick={onPrepareJadeQr} disabled={jadeBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {jadeBusy ? <Loader className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                    {jadeBusy ? 'Creating request...' : 'Create signing QR'}
                  </button>
                </div>
              )}
              {descriptorError && <p className="text-xs font-medium text-red-700">{descriptorError}</p>}
              <ConnectionMethodHelp compact guideId="hardware-jade-qr" />
            </section>
          )}

          {usesPsbt && (!isHardware || hardwareMethod === 'psbt') && (
            <section className="grid gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-white p-2 text-orange-600 shadow-sm ring-1 ring-orange-100">
                  <FileKey2 className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Import wallet policy</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Recommended for hardware and multisig wallets. Export a public descriptor from the companion app.
                  </p>
                </div>
              </div>

              <textarea
                value={descriptorInput}
                onChange={(event) => onDescriptorInputChange(event.target.value)}
                placeholder="pkh(...), wpkh(...), sh(wpkh(...)) or wsh(...)"
                rows={3}
                spellCheck={false}
                className="min-w-0 resize-y rounded-xl border border-orange-200 bg-white px-4 py-3 font-mono text-xs text-slate-950 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
              />

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Address chain
                  <select
                    value={descriptorBranch}
                    onChange={(event) => onDescriptorBranchChange(Number(event.target.value))}
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400"
                  >
                    <option value={0}>Receive</option>
                    <option value={1}>Change</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Address index
                  <input
                    type="number"
                    min="0"
                    max="2147483647"
                    value={descriptorIndex}
                    onChange={(event) => onDescriptorIndexChange(Number(event.target.value))}
                    className="min-w-0 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={useDescriptor}
                  disabled={!descriptorInput.trim()}
                  className="self-end rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Use policy
                </button>
              </div>

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-orange-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-orange-500">
                <Upload className="h-4 w-4" />
                Import descriptor file
                <input
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  className="hidden"
                  onChange={(event) => importDescriptorFile(event.target.files?.[0])}
                />
              </label>

              {descriptorInfo && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    {descriptorInfo.policy.totalSigners === 1
                      ? 'Single-signature policy ready'
                      : `${descriptorInfo.policy.requiredSignatures} of ${descriptorInfo.policy.totalSigners} policy ready`}
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-emerald-900">{descriptorInfo.address}</p>
                  <p className="mt-1 text-xs text-emerald-700">
                    {descriptorInfo.checksumVerified ? 'Descriptor checksum verified.' : 'No checksum supplied; verify the derived address on your wallet.'}
                  </p>
                </div>
              )}
              {descriptorError && <p className="text-sm text-red-700">{descriptorError}</p>}
              <p className="text-xs text-slate-500">Public data only. A descriptor must never contain a seed or private key.</p>
            </section>
          )}

          {(!isHardware || !['direct', 'jade-qr'].includes(hardwareMethod)) && (
            <>
              <details className="rounded-xl border border-slate-200 bg-white px-4 py-3" open={!usesPsbt || (!descriptorInput && !descriptorInfo)}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  {usesPsbt ? 'Enter details manually instead' : 'Wallet details'}
                </summary>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-slate-700">Bitcoin address</span>
                    <input
                      value={manualAddress}
                      onChange={(event) => onManualAddressChange(event.target.value)}
                      readOnly={Boolean(descriptorInfo)}
                      placeholder={isMultisig ? 'bc1q... (Native SegWit multisig)' : '1..., 3... or bc1...'}
                      className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 read-only:bg-slate-100 focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                    />
                  </label>

                  {isMultisig && !descriptorInfo && (
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-slate-700">Multisig witness script</span>
                      <textarea
                        value={multisigWitnessScript}
                        onChange={(event) => onMultisigWitnessScriptChange(event.target.value)}
                        placeholder="Hexadecimal witness script exported by your coordinator"
                        rows={3}
                        className="min-w-0 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs text-slate-950 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                      />
                    </label>
                  )}
                </div>
              </details>

              <button
                type="button"
                onClick={onGenerateProof}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                <FileSignature className="h-4 w-4" />
                {usesPsbt ? 'Create signing request' : 'Generate challenge'}
              </button>
              <p className="text-xs text-slate-500">
                {usesPsbt ? 'This virtual proof spends no bitcoin and cannot be broadcast.' : 'Never enter a seed phrase or private key.'}
              </p>
            </>
          )}
          {fileError && <p className="text-sm text-red-600">{fileError}</p>}
        </div>
      ) : jadeQrPayload ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Jade QR request ready
          </div>
          {authHint && <p className="text-sm text-slate-600">{authHint}</p>}
          <ol className="grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-950">
            <li><strong>1.</strong> On the unlocked Jade, open <strong>Scan QR</strong>. Enlarge the low-density QR below, turn up the phone brightness and hold Jade slightly farther away.</li>
            <li><strong>2.</strong> Verify the login message and path <span className="font-mono">{jadeQrPath}</span>, then approve.</li>
            <li><strong>3.</strong> Select <strong>Scan Jade response</strong> here and show Jade’s signature QR to the camera.</li>
          </ol>
          <Suspense fallback={<QrLoading />}>
            <AnimatedJadeMessageQr payload={jadeQrPayload} />
          </Suspense>
          <button
            type="button"
            onClick={() => setShowJadeScanner((visible) => !visible)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              showJadeScanner ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <ScanLine className="h-4 w-4" />
            {showJadeScanner ? 'Hide scanner' : 'Scan Jade response'}
          </button>
          {showJadeScanner && (
            <Suspense fallback={<QrLoading />}>
              <JadeSignatureScanner
                onDecoded={async (value) => {
                  await onAcceptJadeQrSignature?.(value);
                  setShowJadeScanner(false);
                }}
                onClose={() => setShowJadeScanner(false)}
              />
            </Suspense>
          )}
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Jade signature</span>
            <textarea
              value={manualSignature}
              onChange={(event) => onManualSignatureChange(event.target.value)}
              placeholder="Scan the response QR or paste its Base64 signature"
              rows={3}
              spellCheck={false}
              className="min-w-0 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs text-slate-950 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          {jadeStatus && <p className="text-xs font-medium text-blue-700">{jadeStatus}</p>}
          <button
            type="button"
            onClick={onSubmitJadeQrProof}
            disabled={!manualSignature.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-700/15 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Verify and sign in
          </button>
          <ConnectionMethodHelp compact guideId="hardware-jade-qr" />
        </div>
      ) : usesPsbt ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Signing request ready
          </div>
          {authHint && <p className="text-sm text-slate-600">{authHint}</p>}

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-slate-100 p-2 text-slate-700"><PlugZap className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">Sign with a connected wallet</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Fastest option when your wallet supports direct PSBT signing.</p>
              </div>
            </div>
            {!walletConnected ? (
              <button
                type="button"
                onClick={onConnectDirectSigner}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
              >
                <PlugZap className="h-4 w-4" />
                Connect signing wallet
              </button>
            ) : canDirectSign ? (
              <button
                type="button"
                onClick={onSignPsbtDirect}
                disabled={isDirectSigning}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDirectSigning ? <Loader className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                {isDirectSigning ? 'Waiting for wallet...' : signedPsbt ? 'Add another signature' : 'Sign directly'}
              </button>
            ) : (
              <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2.5 text-xs text-slate-600">
                This wallet does not expose direct PSBT signing here. Use QR or file transfer below.
              </p>
            )}
          </section>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowAnimatedQr((visible) => !visible)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                showAnimatedQr ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <QrCode className="h-4 w-4" />
              {showAnimatedQr ? 'Hide QR' : 'Show QR'}
            </button>
            <button
              type="button"
              onClick={() => setShowScanner((visible) => !visible)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                showScanner ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ScanLine className="h-4 w-4" />
              Scan signed QR
            </button>
          </div>

          {showAnimatedQr && (
            <Suspense fallback={<QrLoading />}>
              <AnimatedPsbtQr psbtBase64={signedPsbt || authRequest.unsignedPsbt} />
            </Suspense>
          )}
          {showScanner && (
            <Suspense fallback={<QrLoading />}>
              <BcUrPsbtScanner onDecoded={acceptScannedPsbt} onClose={() => setShowScanner(false)} />
            </Suspense>
          )}

          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Use a PSBT file instead</summary>
            <div className="mt-4 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => downloadBlob(
                    `bitcoin-access-${authRequest.requestId}.psbt`,
                    psbtBase64ToBlob(signedPsbt || authRequest.unsignedPsbt)
                  )}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => copyWithFeedback('psbt', signedPsbt || authRequest.unsignedPsbt)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm font-semibold ${copiedAction === 'psbt' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  {copiedAction === 'psbt' ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedAction === 'psbt' ? 'Copied' : 'Copy'}
                </button>
              </div>

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-orange-400 hover:bg-orange-50">
                <Upload className="h-4 w-4" />
                Import signed PSBT
                <input
                  type="file"
                  accept=".psbt,application/octet-stream,text/plain"
                  className="hidden"
                  onChange={(event) => importPsbt(event.target.files?.[0])}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-semibold text-slate-600">Or paste signed PSBT</span>
                <textarea
                  value={signedPsbt}
                  onChange={(event) => onSignedPsbtChange(event.target.value)}
                  placeholder="cHNidP..."
                  rows={3}
                  className="min-w-0 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                />
              </label>
            </div>
          </details>

          {signedPsbt && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              Signed PSBT received
            </div>
          )}
          {fileError && <p className="text-sm text-red-600">{fileError}</p>}

          <button
            type="button"
            onClick={onSubmitManualProof}
            disabled={!signedPsbt}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/15 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Verify and sign in
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Challenge ready
          </div>
          {authHint && <p className="text-sm text-slate-600">{authHint}</p>}
          <pre className="max-h-52 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {authRequest.challengePreview}
          </pre>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => copyWithFeedback('challenge', authRequest.challengePreview)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold ${copiedAction === 'challenge' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {copiedAction === 'challenge' ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedAction === 'challenge' ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => downloadJson(`bitcoin-access-${authRequest.requestId}.json`, authRequest)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Signature</span>
            <textarea
              value={manualSignature}
              onChange={(event) => onManualSignatureChange(event.target.value)}
              placeholder="Paste the signature returned by your wallet"
              rows={4}
              className="min-w-0 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
            />
          </label>
          <button
            type="button"
            onClick={onSubmitManualProof}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/15 transition hover:bg-orange-600"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isManualDesktop ? 'Verify signature' : 'Verify proof'}
          </button>
        </div>
      )}
    </div>
  );
};

export default AuthProofPanel;
