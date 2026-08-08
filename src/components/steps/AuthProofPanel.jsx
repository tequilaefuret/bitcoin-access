import React, { lazy, Suspense, useState } from 'react';
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
import { psbtBase64ToBlob, psbtFileToBase64 } from '../../lib/psbtFiles';

const AnimatedPsbtQr = lazy(() => import('./AnimatedPsbtQr'));
const BcUrPsbtScanner = lazy(() => import('./BcUrPsbtScanner'));

const QrLoading = () => (
  <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-600">
    <Loader className="h-4 w-4 animate-spin" />
    Loading QR tools...
  </div>
);

const copyText = async (value) => {
  if (value && navigator?.clipboard?.writeText) await navigator.clipboard.writeText(value);
};

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
  manualAddress,
  manualSignature,
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
}) => {
  const [fileError, setFileError] = useState('');
  const [showAnimatedQr, setShowAnimatedQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const isMultisig = selectedPersonaId === 'cold_multisig';
  const isHardware = selectedPersonaId === 'cold_single_seed';
  const usesPsbt = authRequest?.proofFormat === 'bip322-psbt'
    || (authRequest == null && !isManualDesktop && (isMultisig || offlineProofFormat === 'psbt'));

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

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      {!authRequest ? (
        <div className="grid gap-4">
          {isHardware && (
            <div className="rounded-xl bg-slate-200/70 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onOfflineProofFormatChange('psbt')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    offlineProofFormat === 'psbt' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  PSBT
                </button>
                <button
                  type="button"
                  onClick={() => onOfflineProofFormatChange('message')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    offlineProofFormat === 'message' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Message signature
                </button>
              </div>
            </div>
          )}

          {usesPsbt && (
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
          {fileError && <p className="text-sm text-red-600">{fileError}</p>}
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
                  onClick={() => copyText(signedPsbt || authRequest.unsignedPsbt)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" />
                  Copy
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
              onClick={() => copyText(authRequest.challengePreview)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              Copy
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
