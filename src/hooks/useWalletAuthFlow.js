import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUserData, requestAuthChallenge } from '../supabaseClient';
import { loadAuthenticatedUser } from '../lib/userIdentity';
import {
  encodeAuthPayloadToken,
  getAuthModeForMethod,
  getPersona,
  getRecommendedPersona,
  parseAuthPayloadToken
} from '../lib/bitcoinAuth';
import { normalizeBitcoinAddress } from '../lib/bitcoinAddress';
import { getInjectedBitcoinProviders } from '../lib/injectedBitcoinProviders';
import {
  buildTrezorCallbackUrl,
  buildTrezorSuiteRequestUrl,
  createTrezorHandoffState,
  getMobilePlatform,
  getTrezorMobileAvailability,
  isTrezorHandoffFresh,
  parseTrezorSuiteCallback,
  TREZOR_MOBILE_STORAGE_KEY,
} from '../lib/trezorMobile';

const DEFAULT_ERROR = 'Unable to connect the wallet';

const isMobileDevice = () => {
  return getMobilePlatform().mobile;
};

const isWalletInAppBrowser = () => {
  if (typeof window === 'undefined') return false;
  return getInjectedBitcoinProviders(window).length > 0;
};

export default function useWalletAuthFlow({
  modal,
  connectedWallet,
  disconnectWallet,
  walletProfile,
  connectWallet,
  connectInjectedWallet,
  signMessage,
  signPsbt,
  checkBitcoinBalance,
  setAddress,
  setError,
  setProfileSetupAddress,
  setPasswordConfigured,
  setPasswordSetupSkipped,
  setPasswordSetupMode,
  passwordRecoveryRequested,
  setStep,
  hasUserProfile,
}) {
  const recommendedPersonaId = useMemo(() => {
    const recommended = getRecommendedPersona({
      isMobile: isMobileDevice(),
      hasInjectedProvider: Boolean(walletProfile?.capabilities?.supportsMessageSigning)
    });

    return recommended.id;
  }, [walletProfile]);

  const [verificationStep, setVerificationStep] = useState('idle');
  const [isCheckingDB, setIsCheckingDB] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState(recommendedPersonaId);
  const [authMode, setAuthMode] = useState('direct');
  const [authRequest, setAuthRequest] = useState(null);
  const [manualAddress, setManualAddress] = useState('');
  const [manualSignature, setManualSignature] = useState('');
  const [multisigWitnessScript, setMultisigWitnessScript] = useState('');
  const [descriptorInput, setDescriptorInputState] = useState('');
  const [descriptorBranch, setDescriptorBranch] = useState(0);
  const [descriptorIndex, setDescriptorIndex] = useState(0);
  const [descriptorInfo, setDescriptorInfo] = useState(null);
  const [descriptorError, setDescriptorError] = useState('');
  const [signedPsbt, setSignedPsbt] = useState('');
  const [offlineProofFormat, setOfflineProofFormat] = useState('psbt');
  const [authHint, setAuthHint] = useState('');
  const [mobileEntry, setMobileEntry] = useState(false);
  const [mobileDevice] = useState(isMobileDevice);
  const [walletInAppBrowser, setWalletInAppBrowser] = useState(isWalletInAppBrowser);
  const [mobileHandoffUrl, setMobileHandoffUrl] = useState('');
  const [ledgerUsbModule, setLedgerUsbModule] = useState(null);
  const [ledgerAccount, setLedgerAccount] = useState(0);
  const [ledgerStatus, setLedgerStatus] = useState('');
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [trezorUsbModule, setTrezorUsbModule] = useState(null);
  const [trezorAccount, setTrezorAccount] = useState(0);
  const [trezorStatus, setTrezorStatus] = useState('');
  const [trezorBusy, setTrezorBusy] = useState(false);
  const [jadeUsbModule, setJadeUsbModule] = useState(null);
  const [jadeAccount, setJadeAccount] = useState(0);
  const [jadeStatus, setJadeStatus] = useState('');
  const [jadeBusy, setJadeBusy] = useState(false);
  const [jadeQrPayload, setJadeQrPayload] = useState('');
  const [jadeQrPath, setJadeQrPath] = useState('');
  const [jadeQrAccountInfo, setJadeQrAccountInfo] = useState(null);
  const connectAttemptRef = useRef({ id: 0, interval: null });
  const trezorCallbackHandledRef = useRef(false);

  const directLedgerAvailability = ledgerUsbModule?.getLedgerUsbAvailability?.() || {
    supported: false,
    reason: 'Loading direct Ledger support...',
  };
  const directTrezorAvailability = trezorUsbModule?.getTrezorUsbAvailability?.() || {
    supported: false,
    reason: 'Loading direct Trezor support...',
  };
  const jadeUsbAvailability = jadeUsbModule?.getJadeUsbAvailability?.() || {
    supported: false,
    reason: 'Loading direct Jade support...',
  };
  const mobileTrezorAvailability = mobileDevice
    ? getTrezorMobileAvailability()
    : null;
  const ledgerConnectionAvailability = mobileDevice
    ? {
      supported: Boolean(modal),
      mode: 'wallet-app',
      actionLabel: 'Connect Ledger',
      reason: modal ? 'Continue securely through the wallet selector.' : 'Loading the secure wallet selector...',
    }
    : {
      ...directLedgerAvailability,
      mode: 'direct',
      actionLabel: 'Connect Ledger',
    };
  const trezorConnectionAvailability = mobileTrezorAvailability?.mode === 'direct-cable'
    ? {
      ...directTrezorAvailability,
      mode: 'direct-cable',
      actionLabel: 'Connect Trezor',
    }
    : mobileTrezorAvailability || {
      ...directTrezorAvailability,
      mode: 'direct',
      actionLabel: 'Connect Trezor',
    };

  useEffect(() => {
    let active = true;
    if (selectedPersonaId !== 'cold_single_seed') return undefined;
    import('../lib/ledgerUsb').then((module) => {
      if (active) setLedgerUsbModule(module);
    }).catch(() => {
      if (active) setLedgerStatus('Direct Ledger tools could not be loaded. Use a message, QR or PSBT file.');
    });
    return () => { active = false; };
  }, [selectedPersonaId]);

  useEffect(() => {
    let active = true;
    if (selectedPersonaId !== 'cold_single_seed') return undefined;
    import('../lib/jadeUsb').then((module) => {
      if (active) setJadeUsbModule(module);
    }).catch(() => {
      if (active) setJadeStatus('Direct Jade tools could not be loaded. Use the Jade QR option instead.');
    });
    return () => { active = false; };
  }, [selectedPersonaId]);

  useEffect(() => {
    let active = true;
    if (selectedPersonaId !== 'cold_single_seed') return undefined;
    import('../lib/trezorUsb').then((module) => {
      if (!active) return;
      setTrezorUsbModule(module);
      if (module.getTrezorUsbAvailability().supported) {
        module.prepareTrezorConnect().catch(() => {
          if (active) setTrezorStatus('Trezor Connect could not be initialized. Reload the page or use another proof method.');
        });
      }
    }).catch(() => {
      if (active) setTrezorStatus('Direct Trezor tools could not be loaded. Use a message, QR or PSBT file.');
    });
    return () => { active = false; };
  }, [selectedPersonaId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const browserTargetUrl = new URL(window.location.pathname, window.location.origin);
    setMobileHandoffUrl(browserTargetUrl.toString());
  }, []);

  useEffect(() => {
    if (!selectedPersonaId || selectedPersonaId === recommendedPersonaId) {
      setSelectedPersonaId(recommendedPersonaId);
    }
  }, [recommendedPersonaId, selectedPersonaId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const authToken = searchParams.get('auth');
    const entryMode = searchParams.get('entry');

    if (entryMode === 'mobile') {
      setMobileEntry(true);
      setSelectedPersonaId('mobile_hot_wallet');
      setAuthMode('mobile');
      setAuthHint('You are now inside the wallet browser. Tap Connect wallet to continue.');
    }

    setWalletInAppBrowser(isWalletInAppBrowser());

    if (!authToken) return;

    const parsed = parseAuthPayloadToken(authToken);
    if (!parsed) return;

    if (parsed.personaId) {
      setSelectedPersonaId(parsed.personaId);
    }

    if (parsed.address) {
      setManualAddress(parsed.address);
    }

    setAuthRequest(parsed);
    setAuthMode(getAuthModeForMethod(parsed.methodId));
    setAuthHint('Proof request loaded from a shared link.');

    const nextUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }, [recommendedPersonaId]);

  const clearConnectPolling = useCallback(() => {
    if (connectAttemptRef.current.interval) {
      clearInterval(connectAttemptRef.current.interval);
      connectAttemptRef.current.interval = null;
    }
  }, []);

  const clearProofState = useCallback(() => {
    setAuthRequest(null);
    setManualSignature('');
    setSignedPsbt('');
    setAuthHint('');
    setJadeQrPayload('');
    setJadeQrPath('');
  }, []);

  const setDescriptorInput = useCallback((value) => {
    setDescriptorInputState(value);
    setDescriptorInfo(null);
    setDescriptorError('');
  }, []);

  useEffect(() => {
    setLedgerStatus('');
  }, [descriptorBranch, descriptorIndex, ledgerAccount]);

  useEffect(() => {
    setTrezorStatus('');
  }, [descriptorBranch, descriptorIndex, trezorAccount]);

  useEffect(() => {
    setJadeStatus('');
  }, [descriptorBranch, descriptorIndex]);

  useEffect(() => {
    let active = true;
    if (!jadeQrAccountInfo?.descriptor) return undefined;

    import('../lib/outputDescriptor').then(({ deriveOutputDescriptor }) => {
      const result = deriveOutputDescriptor(jadeQrAccountInfo.descriptor, {
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      if (!active) return;
      setDescriptorInfo(result);
      setManualAddress(result.address);
      setDescriptorError('');
    }).catch((derivationError) => {
      if (!active) return;
      setDescriptorInfo(null);
      setDescriptorError(derivationError.message || 'Unable to derive an address from the Jade xpub.');
    });

    return () => { active = false; };
  }, [descriptorBranch, descriptorIndex, jadeQrAccountInfo]);

  const importDescriptor = useCallback(async (value = descriptorInput) => {
    try {
      setDescriptorError('');
      const { deriveOutputDescriptor } = await import('../lib/outputDescriptor');
      const result = deriveOutputDescriptor(value, {
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      setDescriptorInputState(result.descriptor);
      setDescriptorInfo(result);
      setManualAddress(result.address);
      setMultisigWitnessScript(result.witnessScriptHex || '');
      setSelectedPersonaId(result.addressType === 'p2wsh' ? 'cold_multisig' : 'cold_single_seed');
      setOfflineProofFormat('psbt');
      return result;
    } catch (descriptorFailure) {
      const message = descriptorFailure.message || 'Unable to import this descriptor.';
      setDescriptorInfo(null);
      setDescriptorError(message);
      throw descriptorFailure;
    }
  }, [descriptorBranch, descriptorIndex, descriptorInput]);

  useEffect(() => () => clearConnectPolling(), [clearConnectPolling]);

  const routeVerifiedWalletUser = useCallback((verifiedUser, walletAddress) => {
    const passwordConfigured = Boolean(verifiedUser?.password_configured);
    const passwordSetupSkipped = Boolean(verifiedUser?.password_setup_skipped);
    setPasswordConfigured(passwordConfigured);
    setPasswordSetupSkipped(passwordSetupSkipped);

    if (!hasUserProfile(verifiedUser)) {
      setProfileSetupAddress(walletAddress);
      setPasswordSetupMode(passwordRecoveryRequested && passwordConfigured ? 'reset' : 'set');
      setStep('profile-setup');
      return;
    }

    setProfileSetupAddress(null);
    if (passwordRecoveryRequested || (!passwordConfigured && !passwordSetupSkipped)) {
      setPasswordSetupMode(passwordRecoveryRequested && passwordConfigured ? 'reset' : 'set');
      setStep('password-setup');
      return;
    }

    setStep('social');
  }, [
    hasUserProfile,
    passwordRecoveryRequested,
    setPasswordConfigured,
    setPasswordSetupSkipped,
    setPasswordSetupMode,
    setProfileSetupAddress,
    setStep,
  ]);

  const createAuthRequest = useCallback(async (walletAddress, options = {}) => {
    const normalizedAddress = normalizeBitcoinAddress(walletAddress);
    if (!normalizedAddress) throw new Error('The wallet did not provide a Bitcoin address.');
    const persona = getPersona(options.personaId || selectedPersonaId);
    const methodId = options.methodId || persona.primaryMethod || 'direct-signature';

    const serverRequest = await requestAuthChallenge({
      address: normalizedAddress,
      network: 'mainnet',
      personaId: persona.id,
      methodId,
      walletName: options.walletName || walletProfile?.name || 'unknown'
    });
    const sharePayload = { ...serverRequest };
    const request = {
      ...serverRequest,
      shareLink: typeof window === 'undefined'
        ? ''
        : `${window.location.origin}/?auth=${encodeAuthPayloadToken(sharePayload)}`,
    };

    return request;
  }, [selectedPersonaId, walletProfile]);

  const prepareAuthRequest = useCallback(async (walletAddress, options = {}) => {
    const request = await createAuthRequest(walletAddress, options);

    setAuthRequest(request);
    setAuthMode(getAuthModeForMethod(request.methodId || options.methodId));
    setAuthHint('');

    return request;
  }, [createAuthRequest]);

  const finalizeWalletConnection = useCallback(async (walletAddress, options = {}) => {
    const normalizedAddress = normalizeBitcoinAddress(walletAddress);
    if (!normalizedAddress) return null;

    const personaId = options.personaId || selectedPersonaId;
    const proofMode = options.proofMode || 'direct';
    const persona = getPersona(personaId);
    const methodId = options.methodId || persona.primaryMethod || 'direct-signature';
    const request = options.authRequest || await prepareAuthRequest(normalizedAddress, { personaId, methodId });

    if (proofMode === 'manual' || proofMode === 'psbt') {
      const signature = options.signature || manualSignature;

      if (!signature) {
        throw new Error('Signature required for manual proof');
      }

      setVerificationStep('verifying');
      setIsCheckingDB(true);

      const balanceResult = await checkBitcoinBalance(normalizedAddress, {
        message: request.challenge,
        signature,
        authRequest: request,
        personaId,
        methodId,
        proofFormat: options.proofFormat || null
      });

      const verifiedUser = await loadAuthenticatedUser(normalizedAddress, getUserData);

      setAddress(normalizedAddress);

      routeVerifiedWalletUser(verifiedUser, normalizedAddress);

      setVerificationStep('idle');
      setIsCheckingDB(false);
      clearProofState();

      return {
        address: normalizedAddress,
        user: verifiedUser,
        signature,
        signatureVerified: true,
        balanceResult,
      };
    }

    setVerificationStep('signing');
    setIsCheckingDB(false);
    const signatureData = await signMessage(normalizedAddress, {
      message: request.challenge,
      authRequest: request,
      personaId,
      methodId,
      proofMode
    });

    setVerificationStep('verifying');
    setIsCheckingDB(true);

    const balanceResult = await checkBitcoinBalance(normalizedAddress, {
      ...signatureData,
      authRequest: request,
      personaId,
      methodId
    });

    const verifiedUser = await loadAuthenticatedUser(normalizedAddress, getUserData);

    setAddress(normalizedAddress);

    routeVerifiedWalletUser(verifiedUser, normalizedAddress);

    setVerificationStep('idle');
    setIsCheckingDB(false);
    clearProofState();

    return {
      address: normalizedAddress,
      user: verifiedUser,
      signature: signatureData,
      signatureVerified: true,
      balanceResult,
    };
  }, [
    checkBitcoinBalance,
    clearProofState,
    manualSignature,
    prepareAuthRequest,
    selectedPersonaId,
    setAddress,
    routeVerifiedWalletUser,
    signMessage,
  ]);

  const openTrezorSuiteRequest = useCallback(({ method, params, requestId, state }) => {
    if (typeof window === 'undefined') throw new Error('Trezor Suite handoff requires a browser.');
    const callbackUrl = buildTrezorCallbackUrl({
      origin: window.location.origin,
      pathname: window.location.pathname,
      requestId,
      state,
    });
    const handoffUrl = buildTrezorSuiteRequestUrl({ method, params, callbackUrl });
    window.location.assign(handoffUrl);
  }, []);

  const connectTrezorMobile = useCallback(async () => {
    if (typeof window === 'undefined') return null;

    try {
      setError('');
      clearProofState();
      setTrezorBusy(true);
      setVerificationStep('connecting');
      setSelectedPersonaId('cold_single_seed');
      const { buildTrezorPath } = await import('../lib/trezorUsbValidation');
      const path = buildTrezorPath({
        account: Number(trezorAccount),
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      const state = createTrezorHandoffState();
      localStorage.setItem(TREZOR_MOBILE_STORAGE_KEY, JSON.stringify({
        createdAt: Date.now(),
        path,
        stage: 'address',
        state,
      }));
      setTrezorStatus('Opening Trezor Suite to confirm your Bitcoin address.');
      openTrezorSuiteRequest({
        method: 'getAddress',
        params: { coin: 'btc', path, showOnTrezor: true },
        requestId: 1,
        state,
      });
      return null;
    } catch (mobileError) {
      localStorage.removeItem(TREZOR_MOBILE_STORAGE_KEY);
      setTrezorBusy(false);
      setVerificationStep('idle');
      setTrezorStatus('');
      setError(mobileError.message || 'Unable to open Trezor Suite.');
      return null;
    }
  }, [
    clearProofState,
    descriptorBranch,
    descriptorIndex,
    openTrezorSuiteRequest,
    setError,
    trezorAccount,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || trezorCallbackHandledRef.current) return undefined;

    let callback;
    try {
      callback = parseTrezorSuiteCallback(window.location.href);
    } catch (callbackError) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('trezor_state');
      cleanUrl.searchParams.delete('id');
      cleanUrl.searchParams.delete('response');
      window.history.replaceState({}, document.title, cleanUrl.toString());
      localStorage.removeItem(TREZOR_MOBILE_STORAGE_KEY);
      setError(callbackError.message || 'Invalid Trezor Suite response.');
      return undefined;
    }
    if (!callback) return undefined;

    trezorCallbackHandledRef.current = true;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('trezor_state');
    cleanUrl.searchParams.delete('id');
    cleanUrl.searchParams.delete('response');
    window.history.replaceState({}, document.title, cleanUrl.toString());

    const resume = async () => {
      try {
        const pending = JSON.parse(localStorage.getItem(TREZOR_MOBILE_STORAGE_KEY) || 'null');
        if (!isTrezorHandoffFresh(pending) || pending.state !== callback.state) {
          throw new Error('This Trezor Suite request is missing or expired. Start again.');
        }

        setSelectedPersonaId('cold_single_seed');
        setAuthMode('direct');
        setTrezorBusy(true);
        setVerificationStep('connecting');
        const {
          validateTrezorAddress,
          validateTrezorMessageSignature,
        } = await import('../lib/trezorUsbValidation');

        if (callback.requestId === 1 && pending.stage === 'address') {
          const address = validateTrezorAddress(callback.response.payload?.address);
          setManualAddress(address);
          setTrezorStatus('Address received. Preparing the secure login message.');
          const request = await prepareAuthRequest(address, {
            personaId: 'cold_single_seed',
            methodId: 'direct-signature',
            walletName: 'Trezor Suite',
          });
          localStorage.setItem(TREZOR_MOBILE_STORAGE_KEY, JSON.stringify({
            ...pending,
            address,
            authRequest: request,
            stage: 'signature',
          }));
          setVerificationStep('signing');
          setTrezorStatus('Opening Trezor Suite to approve the login message.');
          openTrezorSuiteRequest({
            method: 'signMessage',
            params: {
              coin: 'btc',
              hex: false,
              message: request.challenge,
              path: pending.path,
            },
            requestId: 2,
            state: pending.state,
          });
          return;
        }

        if (callback.requestId !== 2 || pending.stage !== 'signature' || !pending.authRequest) {
          throw new Error('The Trezor Suite response does not match the expected authentication step.');
        }
        const expiresAt = Date.parse(pending.authRequest.expiresAt || pending.authRequest.expires_at || '');
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          throw new Error('The authentication request expired. Start the Trezor connection again.');
        }
        const signature = validateTrezorMessageSignature({
          expectedAddress: pending.address,
          responseAddress: callback.response.payload?.address,
          signature: callback.response.payload?.signature,
        });
        setTrezorStatus('Signature received. Verifying ownership.');
        await finalizeWalletConnection(pending.address, {
          personaId: 'cold_single_seed',
          methodId: 'direct-signature',
          proofMode: 'manual',
          authRequest: pending.authRequest,
          signature,
        });
        localStorage.removeItem(TREZOR_MOBILE_STORAGE_KEY);
        setTrezorStatus('Trezor ownership verified.');
      } catch (resumeError) {
        localStorage.removeItem(TREZOR_MOBILE_STORAGE_KEY);
        setVerificationStep('idle');
        setIsCheckingDB(false);
        setTrezorStatus('');
        setError(resumeError.message || 'Unable to resume the Trezor Suite connection.');
      } finally {
        setTrezorBusy(false);
      }
    };

    resume();
    return undefined;
  }, [finalizeWalletConnection, openTrezorSuiteRequest, prepareAuthRequest, setError]);

  const connectLedgerUsb = useCallback(async () => {
    if (!ledgerUsbModule) {
      setError('The direct Ledger connection is still loading. Try again in a moment.');
      return null;
    }

    try {
      setError('');
      clearProofState();
      setLedgerBusy(true);
      setVerificationStep('connecting');
      setLedgerStatus('Preparing the direct Ledger connection.');
      const { deriveOutputDescriptor } = await import('../lib/outputDescriptor');
      let authRequestForVerification = null;

      const result = await ledgerUsbModule.connectAndSignLedgerAuthentication({
        account: Number(ledgerAccount),
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
        deriveDescriptor: deriveOutputDescriptor,
        onStatus: setLedgerStatus,
        createSigningRequest: async ({ descriptor, descriptorInfo: verifiedDescriptor }) => {
          setDescriptorInputState(descriptor);
          setDescriptorInfo(verifiedDescriptor);
          setDescriptorError('');
          setManualAddress(verifiedDescriptor.address);
          setMultisigWitnessScript('');

          const request = await createAuthRequest(verifiedDescriptor.address, {
            personaId: 'cold_single_seed',
            methodId: 'direct-signature',
            walletName: 'Ledger',
          });
          authRequestForVerification = request;
          setVerificationStep('signing');
          return {
            message: request.challenge,
          };
        },
      });

      if (!authRequestForVerification) {
        throw new Error('The Ledger authentication request was not created.');
      }
      setLedgerStatus('Signature received. Verifying ownership.');
      const verified = await finalizeWalletConnection(result.descriptorInfo.address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        proofMode: 'manual',
        authRequest: authRequestForVerification,
        signature: result.signature,
      });
      setLedgerStatus('Ledger ownership verified.');
      return verified;
    } catch (ledgerError) {
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setLedgerStatus('');
      setError(ledgerError.message || 'Unable to authenticate through the direct Ledger connection.');
      return null;
    } finally {
      setLedgerBusy(false);
    }
  }, [
    clearProofState,
    createAuthRequest,
    descriptorBranch,
    descriptorIndex,
    finalizeWalletConnection,
    ledgerAccount,
    ledgerUsbModule,
    setError,
  ]);

  const connectTrezorUsb = useCallback(async () => {
    if (!trezorUsbModule) {
      setError('The direct Trezor connection is still loading. Try again in a moment.');
      return null;
    }

    try {
      setError('');
      clearProofState();
      setTrezorBusy(true);
      setVerificationStep('connecting');
      setTrezorStatus('Preparing the secure Trezor connection.');

      const verifiedAddress = await trezorUsbModule.getVerifiedTrezorAddress({
        account: Number(trezorAccount),
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
        onStatus: setTrezorStatus,
      });
      setManualAddress(verifiedAddress.address);

      const request = await prepareAuthRequest(verifiedAddress.address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        walletName: 'Trezor',
      });
      setVerificationStep('signing');
      const proof = await trezorUsbModule.signTrezorAuthenticationMessage({
        path: verifiedAddress.path,
        address: verifiedAddress.address,
        device: verifiedAddress.device,
        message: request.challenge,
        onStatus: setTrezorStatus,
      });

      const result = await finalizeWalletConnection(verifiedAddress.address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        proofMode: 'manual',
        authRequest: request,
        signature: proof.signature,
      });
      setTrezorStatus('Trezor ownership verified.');
      return result;
    } catch (trezorError) {
      clearProofState();
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setTrezorStatus('');
      setError(trezorError.message || 'Unable to authenticate with Trezor.');
      return null;
    } finally {
      setTrezorBusy(false);
    }
  }, [
    clearProofState,
    descriptorBranch,
    descriptorIndex,
    finalizeWalletConnection,
    prepareAuthRequest,
    setError,
    trezorAccount,
    trezorUsbModule,
  ]);

  const connectTrezor = useCallback(() => (
    trezorConnectionAvailability.mode === 'suite-app'
      ? connectTrezorMobile()
      : connectTrezorUsb()
  ), [connectTrezorMobile, connectTrezorUsb, trezorConnectionAvailability.mode]);

  const connectJadeUsb = useCallback(async () => {
    if (!jadeUsbModule) {
      setError('The direct Jade connection is still loading. Try again in a moment.');
      return null;
    }

    try {
      setError('');
      clearProofState();
      setJadeBusy(true);
      setVerificationStep('connecting');
      setJadeStatus('Preparing the secure Jade USB connection.');
      let authRequestForVerification = null;

      const proof = await jadeUsbModule.connectAndSignJadeAuthentication({
        account: Number(jadeAccount),
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
        onStatus: setJadeStatus,
        createSigningRequest: async ({ address }) => {
          setManualAddress(address);
          const request = await createAuthRequest(address, {
            personaId: 'cold_single_seed',
            methodId: 'direct-signature',
            walletName: 'Blockstream Jade USB',
          });
          authRequestForVerification = request;
          setVerificationStep('signing');
          return { message: request.challenge };
        },
      });

      if (!authRequestForVerification) throw new Error('The Jade authentication request was not created.');
      setJadeStatus('Signature received. Verifying Jade ownership.');
      const result = await finalizeWalletConnection(proof.address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        proofMode: 'manual',
        authRequest: authRequestForVerification,
        signature: proof.signature,
      });
      setJadeStatus('Jade ownership verified.');
      return result;
    } catch (jadeError) {
      clearProofState();
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setJadeStatus('');
      setError(jadeError.message || 'Unable to authenticate with Jade over USB.');
      return null;
    } finally {
      setJadeBusy(false);
    }
  }, [
    clearProofState,
    createAuthRequest,
    descriptorBranch,
    descriptorIndex,
    finalizeWalletConnection,
    jadeAccount,
    jadeUsbModule,
    setError,
  ]);

  const prepareJadeQrProof = useCallback(async () => {
    try {
      setError('');
      clearProofState();
      setJadeBusy(true);
      setSelectedPersonaId('cold_single_seed');
      setOfflineProofFormat('message');
      const {
        buildJadePath,
        buildJadeQrPayload,
        validateJadeAddress,
      } = await import('../lib/jadeValidation');
      if (!jadeQrAccountInfo?.descriptor) {
        throw new Error('Scan the animated Jade xpub before creating the signing request.');
      }
      const { deriveOutputDescriptor } = await import('../lib/outputDescriptor');
      const derived = deriveOutputDescriptor(jadeQrAccountInfo.descriptor, {
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      const address = validateJadeAddress(derived.address);
      const path = buildJadePath({
        account: Number(jadeQrAccountInfo.account),
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      const request = await prepareAuthRequest(address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        walletName: 'Blockstream Jade QR',
      });
      setJadeQrPath(path);
      setJadeQrPayload(buildJadeQrPayload({ path, message: request.challenge }));
      setJadeStatus('Authentication QR ready. Scan it with Jade.');
      setAuthHint('Scan this exact request with Jade. The response is a signature only; it cannot move bitcoin.');
      return request;
    } catch (jadeError) {
      clearProofState();
      setJadeStatus('');
      setError(jadeError.message || 'Unable to prepare the Jade QR request.');
      return null;
    } finally {
      setJadeBusy(false);
    }
  }, [
    clearProofState,
    descriptorBranch,
    descriptorIndex,
    jadeQrAccountInfo,
    prepareAuthRequest,
    setError,
  ]);

  const acceptJadeAccountQr = useCallback(async (accountInfo) => {
    try {
      setError('');
      clearProofState();
      if (!accountInfo?.descriptor || !Number.isSafeInteger(accountInfo.account)) {
        throw new Error('The scanned Jade account is incomplete.');
      }
      const { deriveOutputDescriptor } = await import('../lib/outputDescriptor');
      const derived = deriveOutputDescriptor(accountInfo.descriptor, {
        branch: Number(descriptorBranch),
        index: Number(descriptorIndex),
      });
      setJadeQrAccountInfo(accountInfo);
      setJadeAccount(accountInfo.account);
      setDescriptorInputState(accountInfo.descriptor);
      setDescriptorInfo(derived);
      setDescriptorError('');
      setManualAddress(derived.address);
      setJadeStatus(`Jade account imported. Address ${derived.address} was derived automatically.`);
      return derived;
    } catch (accountError) {
      setError(accountError.message || 'Unable to import the Jade xpub QR.');
      throw accountError;
    }
  }, [clearProofState, descriptorBranch, descriptorIndex, setError]);

  const acceptJadeQrSignature = useCallback(async (value) => {
    try {
      const { normalizeJadeMessageSignature } = await import('../lib/jadeValidation');
      const signature = normalizeJadeMessageSignature(value);
      setManualSignature(signature);
      setJadeStatus('Jade signature received. Select Verify and sign in.');
      setError('');
      return signature;
    } catch (signatureError) {
      setError(signatureError.message || 'The scanned Jade signature is invalid.');
      throw signatureError;
    }
  }, [setError]);

  const submitJadeQrProof = useCallback(async () => {
    try {
      setError('');
      if (!authRequest || !jadeQrPayload) throw new Error('Generate a fresh Jade QR request first.');
      const { normalizeJadeMessageSignature, validateJadeAddress } = await import('../lib/jadeValidation');
      const address = validateJadeAddress(manualAddress.trim());
      const signature = normalizeJadeMessageSignature(manualSignature);
      await finalizeWalletConnection(address, {
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
        proofMode: 'manual',
        authRequest,
        signature,
      });
      return true;
    } catch (jadeError) {
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setError(jadeError.message || 'Unable to verify the Jade QR signature.');
      return false;
    }
  }, [authRequest, finalizeWalletConnection, jadeQrPayload, manualAddress, manualSignature, setError]);

  const connectThroughWalletModal = useCallback(async ({
    personaId,
    methodId = 'direct-signature',
  }) => {
    setError('');
    clearConnectPolling();

    const attemptId = connectAttemptRef.current.id + 1;
    connectAttemptRef.current.id = attemptId;

    try {
      if (!modal) throw new Error('Wallet modal not initialized. Please reload the page.');
      const currentAddress = modal.getAddress();
      const isConnected = modal.getIsConnectedState();

      if (currentAddress && isConnected) {
        return await finalizeWalletConnection(currentAddress, { personaId, methodId });
      }

      setVerificationStep('connecting');
      await connectWallet();

      let hasConnected = false;
      let closedChecks = 0;
      connectAttemptRef.current.interval = setInterval(async () => {
        if (attemptId !== connectAttemptRef.current.id) {
          clearConnectPolling();
          return;
        }
        try {
          const address = modal.getAddress();
          const connected = modal.getIsConnectedState();
          if (address && connected && !hasConnected) {
            hasConnected = true;
            clearConnectPolling();
            try {
              await finalizeWalletConnection(address, { personaId, methodId });
            } catch (connectionError) {
              setError(connectionError.message || DEFAULT_ERROR);
              setVerificationStep('idle');
              setIsCheckingDB(false);
            }
            return;
          }

          const modalClosed = typeof modal.isOpen === 'function' && !modal.isOpen();
          const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
          closedChecks = modalClosed && pageVisible ? closedChecks + 1 : 0;
          const closedChecksRequired = mobileDevice ? 4 : 1;
          if (closedChecks >= closedChecksRequired) {
            clearConnectPolling();
            if (!hasConnected) {
              setVerificationStep('idle');
              setIsCheckingDB(false);
              setAuthHint('No wallet selected. You can reopen the wallet list when ready.');
            }
          }
        } catch {
          // AppKit state can be temporarily unavailable while switching applications.
        }
      }, 500);
      return null;
    } catch (connectionError) {
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setError(connectionError.message || DEFAULT_ERROR);
      return null;
    }
  }, [
    clearConnectPolling,
    connectWallet,
    finalizeWalletConnection,
    mobileDevice,
    modal,
    setError,
  ]);

  const connectLedger = useCallback(async () => {
    if (ledgerConnectionAvailability.mode !== 'wallet-app') return connectLedgerUsb();

    try {
      setLedgerBusy(true);
      setLedgerStatus('Select Ledger Wallet in the secure wallet selector.');
      if (modal?.getIsConnectedState?.() && connectedWallet && !/ledger/i.test(connectedWallet)) {
        await disconnectWallet?.();
      }
      return await connectThroughWalletModal({
        personaId: 'cold_single_seed',
        methodId: 'direct-signature',
      });
    } finally {
      setLedgerBusy(false);
    }
  }, [
    connectedWallet,
    connectLedgerUsb,
    connectThroughWalletModal,
    disconnectWallet,
    ledgerConnectionAvailability.mode,
    modal,
  ]);

  const handleConnect = useCallback(async () => {
    try {
      const persona = getPersona(selectedPersonaId);

      if (getAuthModeForMethod(persona.primaryMethod) === 'offline') {
        const address = manualAddress.trim();
        if (!address) {
          setAuthMode('offline');
          setAuthHint('Enter the address you want to prove, then generate the proof package.');
          setVerificationStep('idle');
          return;
        }

        await prepareAuthRequest(address, { personaId: persona.id, methodId: persona.primaryMethod });
        setAuthMode('offline');
        setAuthHint('Export the proof package, sign it offline, then paste the signature below.');
        setVerificationStep('idle');
        return;
      }
      return await connectThroughWalletModal({
        personaId: persona.id,
        methodId: persona.primaryMethod,
      });
    } catch (err) {
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setError(err.message || DEFAULT_ERROR);
    }
  }, [
    connectThroughWalletModal,
    manualAddress,
    selectedPersonaId,
    setError,
    prepareAuthRequest
  ]);

  const handleInjectedConnect = useCallback(async (walletId) => {
    if (typeof connectInjectedWallet !== 'function') return null;

    setError('');
    clearConnectPolling();
    setVerificationStep('connecting');

    try {
      const walletAddress = await connectInjectedWallet(walletId);
      if (!walletAddress) {
        setVerificationStep('idle');
        return null;
      }
      return await finalizeWalletConnection(walletAddress, {
        personaId: selectedPersonaId,
      });
    } catch (err) {
      if (err?.code === 'BITCOIN_ACCOUNT_UNAVAILABLE') {
        setAuthHint('This wallet requires a secure wallet session. Continue in the wallet selector.');
        return handleConnect();
      }
      setVerificationStep('idle');
      setIsCheckingDB(false);
      setError(err.message || DEFAULT_ERROR);
      return null;
    }
  }, [
    clearConnectPolling,
    connectInjectedWallet,
    finalizeWalletConnection,
    handleConnect,
    selectedPersonaId,
    setError,
  ]);

  const prepareOfflineProof = useCallback(async () => {
    setError('');
    setAuthMode('offline');
    try {
      const importedPolicy = descriptorInput.trim()
        ? await importDescriptor(descriptorInput)
        : descriptorInfo;
      const address = importedPolicy?.address || manualAddress.trim();
      const personaId = importedPolicy?.addressType === 'p2wsh'
        ? 'cold_multisig'
        : selectedPersonaId;
      const isMultisig = personaId === 'cold_multisig';
      const usesPsbt = isMultisig || offlineProofFormat === 'psbt';

      if (!address) {
        setAuthHint('Import a wallet descriptor or enter an address first.');
        return null;
      }

      const methodId = isMultisig
        ? 'multisig-psbt'
        : usesPsbt
          ? 'bip322-psbt'
          : 'offline-proof';
      const request = await prepareAuthRequest(address, { personaId, methodId });

      if (!usesPsbt) {
        setAuthHint('Sign the exact challenge in your wallet software, then paste the signature here.');
        return {
          ...request,
          signedMessage: request.challenge,
          submittedAt: new Date().toISOString(),
        };
      }

      const { buildBip322Psbt } = await import('../lib/bip322Psbt');
      const psbt = buildBip322Psbt({
        address,
        message: request.challenge,
        redeemScriptHex: importedPolicy?.redeemScriptHex || '',
        witnessScriptHex: isMultisig
          ? importedPolicy?.witnessScriptHex || multisigWitnessScript
          : '',
        bip32Derivations: importedPolicy?.bip32Derivations || [],
      });
      const enrichedRequest = {
        ...request,
        proofFormat: 'bip322-psbt',
        unsignedPsbt: psbt.base64,
        psbtMeta: {
          addressType: psbt.addressType,
          toSpendTxId: psbt.toSpendTxId,
          multisig: psbt.multisig,
        },
      };

      setAuthRequest(enrichedRequest);
      setSignedPsbt('');
      setAuthHint(isMultisig
        ? `Collect ${psbt.multisig.requiredSignatures} of ${psbt.multisig.totalSigners} signatures in your coordinator, then import the signed PSBT.`
        : 'Sign this virtual PSBT in your hardware wallet coordinator, then import the signed PSBT.');
      return enrichedRequest;
    } catch (err) {
      setAuthRequest(null);
      setError(err.message || 'Unable to generate the PSBT proof.');
      return null;
    }
  }, [
    descriptorInfo,
    descriptorInput,
    importDescriptor,
    manualAddress,
    multisigWitnessScript,
    offlineProofFormat,
    prepareAuthRequest,
    selectedPersonaId,
    setError,
  ]);

  const signPreparedPsbt = useCallback(async () => {
    if (!authRequest?.unsignedPsbt || authRequest?.proofFormat !== 'bip322-psbt') {
      setError('Generate the PSBT proof before requesting a direct signature.');
      return null;
    }

    if (typeof signPsbt !== 'function') {
      setError('Direct PSBT signing is unavailable. Use QR or file transfer instead.');
      return null;
    }

    try {
      setError('');
      setVerificationStep('signing');
      const signed = await signPsbt(
        authRequest.address,
        signedPsbt.trim() || authRequest.unsignedPsbt,
      );
      setSignedPsbt(signed);
      setAuthHint(selectedPersonaId === 'cold_multisig'
        ? 'Signature added. Collect the remaining signatures, or verify when the multisig threshold is complete.'
        : 'PSBT signed. Verify the proof to finish signing in.');
      return signed;
    } catch (signingError) {
      setError(signingError.message || 'Unable to sign the PSBT directly. Use QR or file transfer instead.');
      return null;
    } finally {
      setVerificationStep('idle');
    }
  }, [authRequest, selectedPersonaId, setError, signPsbt, signedPsbt]);

  const prepareManualProof = useCallback(async () => {
    const address = manualAddress.trim();

    setAuthMode('manual');

    if (!address) {
      setAuthHint('Enter the Bitcoin address exposed by your wallet, then generate the challenge. Never enter a seed or private key.');
      return null;
    }

    const request = await prepareAuthRequest(address, {
      personaId: 'desktop_hot_wallet',
      methodId: 'manual-signature'
    });

    setAuthMode('manual');
    setAuthHint('Copy this exact challenge into your wallet’s Sign message feature, then paste the returned signature.');

    return {
      ...request,
      signedMessage: request.challenge,
      submittedAt: new Date().toISOString(),
    };
  }, [manualAddress, prepareAuthRequest]);

  const selectAutomaticDesktop = useCallback(() => {
    clearProofState();
    setAuthMode('direct');
    setAuthHint('Compatible installed wallets are detected automatically through the standards they expose.');
  }, [clearProofState]);

  const selectWalletType = useCallback((personaId) => {
    const persona = getPersona(personaId);

    clearProofState();
    setSelectedPersonaId(persona.id);
    setAuthMode(getAuthModeForMethod(persona.primaryMethod));
    setOfflineProofFormat('psbt');
    setDescriptorInputState('');
    setDescriptorInfo(null);
    setDescriptorError('');
    setJadeQrAccountInfo(null);
    setLedgerStatus('');
    setTrezorStatus('');
    setJadeStatus('');
  }, [clearProofState]);

  const selectOfflineProofFormat = useCallback((format) => {
    clearProofState();
    setOfflineProofFormat(format === 'message' ? 'message' : 'psbt');
  }, [clearProofState]);

  const submitManualProof = useCallback(async () => {
    setError('');

    const address = manualAddress.trim();
    const usesPsbt = authRequest?.proofFormat === 'bip322-psbt';
    const signature = (usesPsbt ? signedPsbt : manualSignature).trim();

    if (!address) {
      setError('Enter the Bitcoin address first.');
      return false;
    }

    if (!signature) {
      setError(usesPsbt ? 'Import or paste the signed PSBT.' : 'Paste the signature produced offline.');
      return false;
    }

    try {
      const persona = getPersona(selectedPersonaId);
      const methodId = authRequest?.methodId || persona.primaryMethod || 'manual-signature';
      const request = authRequest || await prepareAuthRequest(address, {
        personaId: selectedPersonaId,
        methodId
      });

      await finalizeWalletConnection(address, {
        personaId: selectedPersonaId,
        methodId,
        proofMode: usesPsbt ? 'psbt' : 'manual',
        proofFormat: usesPsbt ? 'bip322-psbt' : null,
        authRequest: request,
        signature
      });
      return true;
    } catch (err) {
      setError(err.message || DEFAULT_ERROR);
      return false;
    }
  }, [
    authRequest,
    finalizeWalletConnection,
    manualAddress,
    manualSignature,
    prepareAuthRequest,
    selectedPersonaId,
    setError,
    signedPsbt,
  ]);

  const resetAuthFlow = useCallback(() => {
    clearConnectPolling();
    clearProofState();
    setVerificationStep('idle');
    setIsCheckingDB(false);
    setAuthHint('');
    setDescriptorInputState('');
    setDescriptorInfo(null);
    setDescriptorError('');
    setJadeQrAccountInfo(null);
    setDescriptorBranch(0);
    setDescriptorIndex(0);
    setLedgerStatus('');
    setTrezorStatus('');
    setJadeStatus('');
  }, [clearConnectPolling, clearProofState]);

  return {
    handleConnect,
    handleInjectedConnect,
    resetAuthFlow,
    verificationStep,
    isCheckingDB,
    clearConnectPolling,
    selectedPersonaId,
    setSelectedPersonaId,
    selectWalletType,
    authMode,
    setAuthMode,
    authRequest,
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
    authHint,
    prepareOfflineProof,
    prepareManualProof,
    selectAutomaticDesktop,
    submitManualProof,
    signPreparedPsbt,
    connectLedgerUsb: connectLedger,
    ledgerAccount,
    setLedgerAccount,
    ledgerStatus,
    ledgerBusy,
    ledgerUsbAvailability: ledgerConnectionAvailability,
    connectTrezorUsb: connectTrezor,
    trezorAccount,
    setTrezorAccount,
    trezorStatus,
    trezorBusy,
    trezorUsbAvailability: trezorConnectionAvailability,
    connectJadeUsb,
    prepareJadeQrProof,
    acceptJadeAccountQr,
    acceptJadeQrSignature,
    submitJadeQrProof,
    jadeAccount,
    setJadeAccount,
    jadeStatus,
    jadeBusy,
    jadeUsbAvailability,
    jadeQrPayload,
    jadeQrPath,
    jadeQrAccountInfo,
    mobileEntry,
    mobileDevice,
    walletInAppBrowser,
    mobileHandoffUrl,
  };
}
