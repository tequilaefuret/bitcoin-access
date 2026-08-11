import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  Layers3,
  Loader,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Wallet
} from 'lucide-react';
import { getPersonaList, getPersona } from '../../lib/bitcoinAuth';
import AuthProofPanel from './AuthProofPanel';
import ConnectionMethodHelp from './ConnectionMethodHelp';
import { copyToClipboard } from '../../lib/clipboard';

const WALLET_TYPES = getPersonaList();

const walletTypeDetails = {
  desktop_hot_wallet: { label: 'Browser', icon: Wallet },
  mobile_hot_wallet: { label: 'Mobile', icon: Smartphone },
  cold_single_seed: { label: 'Hardware', icon: HardDrive },
  cold_multisig: { label: 'Multisig', icon: Layers3 }
};

const ConnectStep = ({
  onConnect,
  onConnectInjected,
  injectedWallets = [],
  loading,
  error,
  verificationStep = 'idle',
  isCheckingDB = false,
  selectedPersonaId,
  selectWalletType,
  authRequest,
  authHint,
  manualAddress,
  setManualAddress,
  manualSignature,
  setManualSignature,
  multisigWitnessScript,
  setMultisigWitnessScript,
  descriptorInput,
  setDescriptorInput,
  descriptorBranch,
  setDescriptorBranch,
  descriptorIndex,
  setDescriptorIndex,
  descriptorInfo,
  descriptorError,
  importDescriptor,
  signedPsbt,
  setSignedPsbt,
  offlineProofFormat,
  selectOfflineProofFormat,
  prepareOfflineProof,
  prepareManualProof,
  selectAutomaticDesktop,
  submitManualProof,
  signPreparedPsbt,
  connectLedgerUsb,
  ledgerAccount,
  setLedgerAccount,
  ledgerStatus,
  ledgerBusy,
  ledgerUsbAvailability,
  connectTrezorUsb,
  trezorAccount,
  setTrezorAccount,
  trezorStatus,
  trezorBusy,
  trezorUsbAvailability,
  connectJadeUsb,
  prepareJadeQrProof,
  acceptJadeQrSignature,
  submitJadeQrProof,
  jadeAccount,
  setJadeAccount,
  jadeStatus,
  jadeBusy,
  jadeUsbAvailability,
  jadeQrPayload,
  jadeQrPath,
  walletConnected,
  canDirectSign,
  connectDirectSigner,
  mobileEntry,
  mobileDevice = false,
  walletInAppBrowser = false,
  mobileHandoffUrl,
  authMode,
  onPasswordLogin,
  onPasswordRecovery,
  onUseWallet,
}) => {
  const [showMobileLink, setShowMobileLink] = useState(false);
  const [mobileLinkCopied, setMobileLinkCopied] = useState(false);
  const [accessMode, setAccessMode] = useState(mobileEntry || mobileDevice ? 'wallet' : 'password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isPasswordLoginLoading, setIsPasswordLoginLoading] = useState(false);
  const [hardwareMethod, setHardwareMethod] = useState('direct');
  const selectedWalletType = useMemo(
    () => getPersona(selectedPersonaId),
    [selectedPersonaId]
  );

  useEffect(() => {
    if (mobileEntry || mobileDevice) setAccessMode('wallet');
  }, [mobileDevice, mobileEntry]);

  const isBrowser = selectedWalletType.id === 'desktop_hot_wallet';
  const isMobile = selectedWalletType.id === 'mobile_hot_wallet';
  const isManualBrowser = isBrowser && authMode === 'manual';
  const usesPortableProof = isManualBrowser || authMode === 'offline' || Boolean(jadeQrPayload);

  const statusLabel = isCheckingDB || verificationStep === 'verifying'
    ? 'Verifying signature'
    : verificationStep === 'signing'
      ? 'Waiting for signature'
      : verificationStep === 'connecting'
        ? 'Connecting wallet'
        : loading
          ? 'Connecting'
          : '';

  const handleMobileConnect = async () => {
    if (walletInAppBrowser && injectedWallets.length === 1) {
      await onConnectInjected?.(injectedWallets[0].id);
      return;
    }
    await onConnect?.();
  };

  const handleCopyMobileLink = async () => {
    if (!await copyToClipboard(mobileHandoffUrl)) return;
    setMobileLinkCopied(true);
    setTimeout(() => setMobileLinkCopied(false), 1800);
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');

    try {
      setIsPasswordLoginLoading(true);
      await onPasswordLogin?.(identifier.trim(), password);
    } catch (loginFailure) {
      setLoginError(loginFailure.message || 'Unable to sign in');
    } finally {
      setIsPasswordLoginLoading(false);
    }
  };

  const showWalletConnection = () => {
    setAccessMode('wallet');
    setLoginError('');
    onUseWallet?.();
  };

  const startPasswordRecovery = () => {
    setAccessMode('wallet');
    setLoginError('');
    onPasswordRecovery?.();
  };

  return (
    <div className="mx-auto w-full max-w-2xl py-4 sm:py-8">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.38)]">
        <header className="border-b border-slate-100 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Bitcoin Access</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {accessMode === 'password' ? 'Sign in' : 'Use your wallet'}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {accessMode === 'password'
                  ? 'Access your account without signing again.'
                  : 'Prove wallet ownership. No transaction or fee.'}
              </p>
            </div>
          </div>
        </header>

        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setAccessMode('password')}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                accessMode === 'password' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={showWalletConnection}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                accessMode === 'wallet' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Wallet
            </button>
          </div>

          {accessMode === 'password' ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Username or Bitcoin address</span>
                <input
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  maxLength={100}
                  required
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-950 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
                  placeholder="Username or bc1..."
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
                    placeholder="Your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </label>

              {loginError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isPasswordLoginLoading || !identifier.trim() || !password}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPasswordLoginLoading ? <Loader className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
                {isPasswordLoginLoading ? 'Signing in...' : 'Sign in'}
                {!isPasswordLoginLoading && <ArrowRight className="h-5 w-5" />}
              </button>

              <div className="flex flex-col items-center gap-3 pt-2 text-sm sm:flex-row sm:justify-between">
                <button type="button" onClick={startPasswordRecovery} className="font-semibold text-slate-500 hover:text-slate-900">
                  Forgot password?
                </button>
                <button type="button" onClick={showWalletConnection} className="font-semibold text-orange-600 hover:text-orange-700">
                  Create an account with a wallet
                </button>
              </div>
            </form>
          ) : (
            <>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Wallet type</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WALLET_TYPES.map((walletType) => {
              const details = walletTypeDetails[walletType.id];
              const TypeIcon = details.icon;
              const isSelected = walletType.id === selectedPersonaId;

              return (
                <button
                  key={walletType.id}
                  type="button"
                  onClick={() => selectWalletType?.(walletType.id)}
                  className={`relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                    isSelected
                      ? 'border-slate-950 bg-slate-950 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <TypeIcon className="h-5 w-5" />
                  <span>{details.label}</span>
                  {isSelected && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isBrowser && (
            <div className="mt-6 rounded-2xl bg-slate-100 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={selectAutomaticDesktop}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    authMode === 'direct' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  onClick={prepareManualProof}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    authMode === 'manual' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Manual signature
                </button>
              </div>
            </div>
          )}

          {statusLabel && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
              <Loader className="h-4 w-4 animate-spin" />
              {statusLabel}
            </div>
          )}

          {verificationStep === 'signing' && mobileDevice && (
            <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
              Approve the signature in your wallet. If another app opens, return here manually after approval.
            </p>
          )}

          {authHint && !usesPortableProof && (
            <p className="mt-4 text-sm text-slate-500">{authHint}</p>
          )}

          {isBrowser && authMode === 'direct' && (
            <div className="mt-6 grid gap-3">
              {injectedWallets.length > 0 && (
                <>
                  <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" />
                    Detected in this browser
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  {injectedWallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => onConnectInjected?.(wallet.id)}
                      disabled={loading || Boolean(statusLabel)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Wallet className="h-4 w-4" />
                      Connect with {wallet.name}
                    </button>
                  ))}
                  <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" />
                    Other wallets
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={onConnect}
                disabled={loading || Boolean(statusLabel)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Wallet className="h-5 w-5" />
                {injectedWallets.length > 0 ? 'Find another wallet' : 'Find a wallet'}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {isMobile && (
            <div className="mt-6 grid gap-3">
              {mobileDevice ? (
                <button
                  type="button"
                  onClick={handleMobileConnect}
                  disabled={loading || Boolean(statusLabel)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Wallet className="h-5 w-5" />
                  {walletInAppBrowser && injectedWallets.length === 1
                    ? `Continue with ${injectedWallets[0].name}`
                    : 'Find a wallet'}
                  <ArrowRight className="h-5 w-5" />
                </button>
              ) : (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                  Scan this QR code with your mobile wallet, or open the link below in your mobile browser.
                </div>
              )}

              {mobileDevice && (
                <button
                  type="button"
                  onClick={() => setShowMobileLink((value) => !value)}
                  className="w-full py-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
                >
                  {showMobileLink ? 'Hide QR code and link' : 'Show QR code and copyable link'}
                </button>
              )}

              {(!mobileDevice || showMobileLink) && mobileHandoffUrl && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
                  <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                    <QRCodeSVG value={mobileHandoffUrl} size={176} bgColor="#ffffff" fgColor="#0f172a" includeMargin />
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyMobileLink}
                    className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${mobileLinkCopied ? 'text-emerald-700' : 'text-slate-600 hover:text-slate-950'}`}
                  >
                    {mobileLinkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {mobileLinkCopied ? 'Link copied' : 'Copy link'}
                  </button>
                  {mobileDevice && (
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      Use this if your wallet cannot be opened from the wallet list. Paste the link into its in-app browser.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {usesPortableProof && (
            <AuthProofPanel
              authRequest={authRequest}
              authHint={authHint}
              manualAddress={manualAddress}
              manualSignature={manualSignature}
              onManualAddressChange={setManualAddress}
              onManualSignatureChange={setManualSignature}
              onGenerateProof={isManualBrowser ? prepareManualProof : prepareOfflineProof}
              onSubmitManualProof={submitManualProof}
              isManualDesktop={isManualBrowser}
              selectedPersonaId={selectedPersonaId}
              multisigWitnessScript={multisigWitnessScript}
              onMultisigWitnessScriptChange={setMultisigWitnessScript}
              descriptorInput={descriptorInput}
              onDescriptorInputChange={setDescriptorInput}
              descriptorBranch={descriptorBranch}
              onDescriptorBranchChange={setDescriptorBranch}
              descriptorIndex={descriptorIndex}
              onDescriptorIndexChange={setDescriptorIndex}
              descriptorInfo={descriptorInfo}
              descriptorError={descriptorError}
              onImportDescriptor={importDescriptor}
              signedPsbt={signedPsbt}
              onSignedPsbtChange={setSignedPsbt}
              offlineProofFormat={offlineProofFormat}
              onOfflineProofFormatChange={selectOfflineProofFormat}
              walletConnected={walletConnected}
              canDirectSign={canDirectSign}
              onConnectDirectSigner={connectDirectSigner}
              onSignPsbtDirect={signPreparedPsbt}
              isDirectSigning={verificationStep === 'signing'}
              onConnectLedger={connectLedgerUsb}
              ledgerAccount={ledgerAccount}
              onLedgerAccountChange={setLedgerAccount}
              ledgerStatus={ledgerStatus}
              ledgerBusy={ledgerBusy}
              ledgerUsbAvailability={ledgerUsbAvailability}
              onConnectTrezor={connectTrezorUsb}
              trezorAccount={trezorAccount}
              onTrezorAccountChange={setTrezorAccount}
              trezorStatus={trezorStatus}
              trezorBusy={trezorBusy}
              trezorUsbAvailability={trezorUsbAvailability}
              onConnectJade={connectJadeUsb}
              onPrepareJadeQr={prepareJadeQrProof}
              onAcceptJadeQrSignature={acceptJadeQrSignature}
              onSubmitJadeQrProof={submitJadeQrProof}
              jadeAccount={jadeAccount}
              onJadeAccountChange={setJadeAccount}
              jadeStatus={jadeStatus}
              jadeBusy={jadeBusy}
              jadeUsbAvailability={jadeUsbAvailability}
              jadeQrPayload={jadeQrPayload}
              jadeQrPath={jadeQrPath}
              hardwareMethod={hardwareMethod}
              onHardwareMethodChange={setHardwareMethod}
            />
          )}

          {!(selectedPersonaId === 'cold_single_seed' && ['direct', 'jade-qr'].includes(hardwareMethod)) && (
            <ConnectionMethodHelp
              selectedPersonaId={selectedPersonaId}
              authMode={authMode}
              offlineProofFormat={offlineProofFormat}
              mobileDevice={mobileDevice}
              walletInAppBrowser={walletInAppBrowser || mobileEntry}
            />
          )}

          {error && (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              Read-only ownership proof
            </span>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectStep;
