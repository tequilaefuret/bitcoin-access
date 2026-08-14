import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import ConnectStep from './components/steps/ConnectStep';
import ProfileSetupStep from './components/steps/ProfileSetupStep';
import PasswordSetupStep from './components/steps/PasswordSetupStep';
import EnvIndicator from './components/ui/EnvIndicator';
import LandingPage from './components/landing/LandingPage';
import { useBitcoinBalance } from './hooks/useBitcoinBalance';
import useReownWallet from './hooks/useReownWallet';
import useWalletAuthFlow from './hooks/useWalletAuthFlow';
import {
  getUserData,
  loginWithPassword,
  logoutSession,
  restoreSession,
  skipPasswordSetup,
  listFollowingAddresses,
  setFollowingAddress,
} from './supabaseClient';
import { hasUserProfile } from './lib/userIdentity';
import {
  DEFAULT_USER_PREFERENCES,
  loadUserPreferences,
  saveUserPreferences,
  shouldReduceMotion,
} from './lib/userPreferences';

const SocialStep = lazy(() => import('./components/steps/SocialStep'));
const GameStep = lazy(() => import('./components/steps/GameStep'));
const ProfileStep = lazy(() => import('./components/steps/ProfileStep'));
const CanvasStep = lazy(() => import('./components/steps/CanvasStep'));
const HistoryModal = lazy(() => import('./components/ui/HistoryModal'));
const StatsModal = lazy(() => import('./components/ui/StatsModal'));
const SettingsStep = lazy(() => import('./components/steps/SettingsStep'));

const FOLLOWING_KEY = 'danaus_following_addresses';

const safeParseArray = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const ScreenFallback = () => (
  <div className="flex min-h-48 items-center justify-center" aria-label="Loading">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500" />
  </div>
);

const BitcoinExclusiveAccess = () => {
  const [step, setStep] = useState('landing');
  const [showHistory, setShowHistory] = useState(false);
  const [userMessages, setUserMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [profileAddress, setProfileAddress] = useState(null);
  const [profileReturnStep, setProfileReturnStep] = useState('social');
  const [settingsReturnStep, setSettingsReturnStep] = useState('social');
  const [profileSetupAddress, setProfileSetupAddress] = useState(null);
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [passwordSetupSkipped, setPasswordSetupSkipped] = useState(false);
  const [passwordSetupMode, setPasswordSetupMode] = useState('set');
  const [passwordRecoveryRequested, setPasswordRecoveryRequested] = useState(false);
  const [userPreferences, setUserPreferences] = useState({ ...DEFAULT_USER_PREFERENCES });
  const [systemPrefersReducedMotion, setSystemPrefersReducedMotion] = useState(() => shouldReduceMotion('system'));
  const [followingAddresses, setFollowingAddresses] = useState(() => safeParseArray(localStorage.getItem(FOLLOWING_KEY)));

  const {
    address,
    btcBalance,
    shellsAvailable,
    loading,
    error,
    setAddress,
    setError,
    restoreAuthenticatedUser,
    checkBitcoinBalance,
    startGame,
    publishMessage,
    loadMessages,
    loadComments,
    loadUserMessages,
    manualSync,
    loadSpendingHistory,
    submitCanvasPixels,
    loadCanvasPixels,
    loadUserPixelCount,
    toggleUseful,
    repostMessage,
    hideForYouMessage,
    updateEditorialAuthorPreference,
    loadEditorialAuthorPreferences,
    reportMessage,
    reportProfile,
    loadOpinionTopics,
    savePrivateTopicStance
  } = useBitcoinBalance();

  const {
    connectedAddress,
    connectedWallet,
    walletProfile,
    modal,
    disconnectWallet,
    connectWallet,
    connectInjectedWallet,
    injectedWallets,
    signMessage,
    signPsbt,
    isConnecting
  } = useReownWallet();
  const authenticatedAddress = address || null;
  const showPrivateSession = Boolean(authenticatedAddress)
    && !['connect', 'profile-setup', 'password-setup'].includes(step);
  const reduceMotion = userPreferences.motion === 'reduced'
    || (userPreferences.motion === 'system' && systemPrefersReducedMotion);

  const routeToNetwork = useCallback(() => {
    setStep('social');
  }, []);

  useEffect(() => {
    setUserPreferences(loadUserPreferences(address));
  }, [address]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setSystemPrefersReducedMotion(mediaQuery.matches);
    updateMotionPreference();
    mediaQuery.addEventListener?.('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener?.('change', updateMotionPreference);
  }, []);

  const {
    handleConnect,
    handleInjectedConnect,
    resetAuthFlow,
    verificationStep,
    isCheckingDB,
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
    authMode
  } = useWalletAuthFlow({
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
  });

  const isFollowing = useCallback((bitcoinAddress) => {
    if (!bitcoinAddress) return false;
    return followingAddresses.includes(bitcoinAddress);
  }, [followingAddresses]);

  const handleToggleFollow = useCallback(async (bitcoinAddress) => {
    if (!bitcoinAddress) return;

    const previous = followingAddresses;
    const shouldFollow = !previous.includes(bitcoinAddress);
    const optimistic = shouldFollow
      ? [bitcoinAddress, ...previous]
      : previous.filter((item) => item !== bitcoinAddress);

    // Follow is free: reflect the click immediately, then reconcile with the
    // server response. Roll back only if the authenticated write fails.
    setFollowingAddresses(optimistic);
    localStorage.setItem(FOLLOWING_KEY, JSON.stringify(optimistic));

    try {
      const next = address
        ? await setFollowingAddress(address, bitcoinAddress, shouldFollow)
        : optimistic;
      setFollowingAddresses(next);
      localStorage.setItem(FOLLOWING_KEY, JSON.stringify(next));
      return next;
    } catch (followError) {
      setFollowingAddresses(previous);
      localStorage.setItem(FOLLOWING_KEY, JSON.stringify(previous));
      setError(followError.message || 'Unable to update follow');
      throw followError;
    }
  }, [address, followingAddresses, setError]);

  const handleEditorialPreference = useCallback(async (targetAddress, preference) => {
    const result = await updateEditorialAuthorPreference(targetAddress, preference);

    // Blocking also removes both follow relationships in the database. Keep the
    // local navigation state in sync immediately so the UI never shows a stale
    // "Following" badge after the action succeeds.
    if (preference === 'block') {
      setFollowingAddresses((current) => {
        const next = current.filter((item) => item !== targetAddress);
        localStorage.setItem(FOLLOWING_KEY, JSON.stringify(next));
        return next;
      });
    }

    return result;
  }, [updateEditorialAuthorPreference]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    listFollowingAddresses(address)
      .then((next) => {
        if (cancelled) return;
        setFollowingAddresses(next);
        localStorage.setItem(FOLLOWING_KEY, JSON.stringify(next));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [address]);

  const routeAuthenticatedUser = useCallback((user, sessionAddress) => {
    const hasPassword = Boolean(user?.password_configured);
    const hasSkippedPassword = Boolean(user?.password_setup_skipped);
    setPasswordConfigured(hasPassword);
    setPasswordSetupSkipped(hasSkippedPassword);

    if (!hasUserProfile(user)) {
      setProfileSetupAddress(sessionAddress);
      setStep('profile-setup');
      return;
    }

    setProfileSetupAddress(null);
    if (!hasPassword && !hasSkippedPassword) {
      setPasswordSetupMode('set');
      setStep('password-setup');
      return;
    }

    routeToNetwork();
  }, [routeToNetwork]);

  // ===== VÉRIFICATION SESSION AU CHARGEMENT =====
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const session = await restoreSession();
        if (!session?.address) return;

        const user = await getUserData(session.address, { throwOnError: true });
        if (!user?.ownership_verified) throw new Error('Ownership verification missing');

        restoreAuthenticatedUser(user);
        routeAuthenticatedUser(user, session.address);
      } catch {
      } finally {
        setIsCheckingSession(false);
      }
    };

    checkExistingSession();
  }, [restoreAuthenticatedUser, routeAuthenticatedUser]);

  useEffect(() => {
    if (!isCheckingSession && address && ['landing', 'connect'].includes(step)) {
      routeToNetwork();
    }
  }, [address, isCheckingSession, routeToNetwork, step]);

  // ===== HANDLER : DÉCONNEXION MANUELLE =====
  const handleManualDisconnect = useCallback(async () => {
    try {
      resetAuthFlow();
      await logoutSession();
      await disconnectWallet().catch(() => null);
      setAddress(null);
      setProfileAddress(null);
      setProfileReturnStep('social');
      setProfileSetupAddress(null);
      setPasswordConfigured(false);
      setPasswordSetupSkipped(false);
      setPasswordSetupMode('set');
      setPasswordRecoveryRequested(false);
      setStep('landing');
    } catch (err) {
      setError('Unable to close the session. Please try again.');
    }
  }, [disconnectWallet, resetAuthFlow, setAddress, setError]);

  // ===== HANDLER : DÉMARRER JEU (depuis Dashboard) =====
  const handleGameToPlay = useCallback(async () => {
    if (!address) {
      setError('Your session has expired. Please sign in again.');
      setStep('connect');
      return;
    }
    setError('');
    setStep('game');
  }, [address, setError]);

  // ===== HANDLER : LANCER UNE PARTIE =====
  const handleStartGame = useCallback(async () => {
    if (!address) {
      setError('Your session has expired. Please sign in again.');
      setStep('connect');
      return false;
    }
    return startGame();
  }, [address, startGame, setError]);

  // ===== HANDLER : RETOUR DEPUIS JEU =====
  const handleGameBack = useCallback(() => {
    setError('');
    
    setStep('social');
  }, [setError]);

  // ===== HANDLER : PUBLICATION MESSAGE =====
  const handlePublishMessage = useCallback(async (content, parentId = null) => {
    try {
      if (!address) throw new Error('No active session');
      return await publishMessage(content, parentId);
    } catch (err) {
      setError(err.message || 'Publication failed');
      return { success: false, error: err.message };
    }
  }, [address, publishMessage, setError]);

  // ===== HANDLER : CANVAS - Navigation =====
  const handleStartCanvas = useCallback(() => {
    setError('');
    setStep('canvas');
  }, [setError]);

  const handleCanvasBack = useCallback(() => {
    setError('');
    setStep('social');
  }, [setError]);

  // ===== HANDLER : HISTORIQUE =====
  const handleShowHistory = useCallback(async () => {
    setUserMessages([]); // Reset
    const messages = await loadUserMessages(20, 0);
    setUserMessages(messages);
    setHasMoreMessages(messages.length === 20);
    setShowHistory(true);
  }, [loadUserMessages]);

  const handleLoadMoreHistory = useCallback(async (currentOffset) => {
  const newMessages = await loadUserMessages(20, currentOffset);
  setHasMoreMessages(newMessages.length === 20);
  return newMessages;
}, [loadUserMessages]);

  // ===== HANDLER : STATISTIQUES =====
  const handleShowStats = useCallback(async () => {
    const history = await loadSpendingHistory(20);
    setStats({ history });
    setShowStats(true);
  }, [loadSpendingHistory]);

  // ===== HANDLER : OUVRIR UN PROFIL =====
  const handleOpenProfile = useCallback((bitcoinAddress, returnStep = 'social') => {
    if (!bitcoinAddress) return;
    if (step === 'profile-setup') return;

    setError('');
    setProfileAddress(bitcoinAddress);
    setProfileReturnStep(returnStep === 'profile' ? profileReturnStep : returnStep);
    setStep('profile');
  }, [profileReturnStep, setError, step]);

  // ===== HANDLER : RETOUR DU PROFIL =====
  const handleProfileBack = useCallback(() => {
    setError('');
    setStep(profileReturnStep || 'social');
  }, [profileReturnStep, setError]);

  const handleOpenSettings = useCallback(() => {
    setError('');
    setSettingsReturnStep(['profile', 'game', 'canvas'].includes(step) ? step : 'social');
    setStep('settings');
  }, [setError, step]);

  const handleSettingsBack = useCallback(() => {
    setError('');
    setStep(settingsReturnStep || 'social');
  }, [setError, settingsReturnStep]);

  const handlePreferencesChange = useCallback((nextPreferences) => {
    setUserPreferences(saveUserPreferences(address, nextPreferences));
  }, [address]);

  // ===== HANDLER : PSEUDO CRÉÉ =====
  const handleProfileSetupComplete = useCallback(() => {
    setError('');
    setProfileSetupAddress(null);
    if ((!passwordConfigured && !passwordSetupSkipped) || passwordRecoveryRequested) {
      setPasswordSetupMode(passwordRecoveryRequested && passwordConfigured ? 'reset' : 'set');
      setStep('password-setup');
      return;
    }
    routeToNetwork();
  }, [passwordConfigured, passwordRecoveryRequested, passwordSetupSkipped, routeToNetwork, setError]);

  const handlePasswordLogin = useCallback(async (identifier, password) => {
    setError('');
    const session = await loginWithPassword(identifier, password);
    const user = await getUserData(session.address, { throwOnError: true });
    if (!user?.ownership_verified) throw new Error('Ownership verification missing');

    restoreAuthenticatedUser(user);
    setPasswordRecoveryRequested(false);
    routeAuthenticatedUser(user, session.address);
  }, [restoreAuthenticatedUser, routeAuthenticatedUser, setError]);

  const handlePasswordSetupComplete = useCallback(() => {
    setError('');
    setPasswordConfigured(true);
    setPasswordSetupSkipped(false);
    setPasswordRecoveryRequested(false);
    setPasswordSetupMode('set');
    routeToNetwork();
  }, [routeToNetwork, setError]);

  const handlePasswordSetupSkip = useCallback(async () => {
    await skipPasswordSetup();
    setPasswordConfigured(false);
    setPasswordSetupSkipped(true);
    setPasswordRecoveryRequested(false);
    setPasswordSetupMode('set');
    routeToNetwork();
  }, [routeToNetwork]);

  const handleAddPassword = useCallback(() => {
    setError('');
    setPasswordRecoveryRequested(false);
    setPasswordSetupMode('set');
    setStep('password-setup');
  }, [setError]);

  // ===== ÉCRAN DE CHARGEMENT =====
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Checking your session...</p>
        </div>
      </div>
    );
  }

  // ===== RENDU PRINCIPAL =====
  return (
    <div className={`${step === 'landing'
      ? 'min-h-screen'
      : step === 'connect'
        ? 'relative isolate min-h-screen overflow-x-hidden bg-[#07080c] px-4 pb-8 text-white selection:bg-amber-300 selection:text-slate-950 sm:px-6'
        : 'min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 p-4'
    } ${reduceMotion ? 'danaus-reduce-motion' : ''}`}>
      {step !== 'landing' && <EnvIndicator />}

      {step === 'connect' && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="absolute left-1/2 top-[-26rem] h-[54rem] w-[64rem] -translate-x-1/2 rounded-full bg-amber-500/20 blur-[140px]" />
          <div className="absolute bottom-[-18rem] right-[-12rem] h-[38rem] w-[38rem] rounded-full bg-orange-600/10 blur-[130px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
        </div>
      )}

      {step === 'landing' ? (
        <LandingPage onStart={() => setStep('connect')} onSignIn={() => setStep('connect')} />
      ) : (
      <div className={`${step === 'connect' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto`}>
          <Header 
          connectedAddress={showPrivateSession ? authenticatedAddress : null}
          connectedWallet={connectedWallet}
          minimal={step === 'connect'}
          onHome={() => setStep('landing')}
          onDisconnect={handleManualDisconnect}
          onSettings={showPrivateSession ? handleOpenSettings : null}
          showFullAddress={userPreferences.showFullAddress}
          onViewProfile={
            !showPrivateSession
              ? null
              : () => handleOpenProfile(authenticatedAddress, 'social')
          }
        />

        <div className={step === 'connect' ? 'mb-6' : 'mb-6 rounded-2xl bg-white p-8 shadow-2xl'}>
          {step === 'connect' && (
            <ConnectStep 
              onConnect={handleConnect}
              onConnectInjected={handleInjectedConnect}
              injectedWallets={injectedWallets}
              loading={loading || isConnecting}
              error={error}
              verificationStep={verificationStep}
              isCheckingDB={isCheckingDB}
              selectedPersonaId={selectedPersonaId}
              selectWalletType={selectWalletType}
              authRequest={authRequest}
              authHint={authHint}
              manualAddress={manualAddress}
              setManualAddress={setManualAddress}
              manualSignature={manualSignature}
              setManualSignature={setManualSignature}
              multisigWitnessScript={multisigWitnessScript}
              setMultisigWitnessScript={setMultisigWitnessScript}
              descriptorInput={descriptorInput}
              setDescriptorInput={setDescriptorInput}
              descriptorBranch={descriptorBranch}
              setDescriptorBranch={setDescriptorBranch}
              descriptorIndex={descriptorIndex}
              setDescriptorIndex={setDescriptorIndex}
              descriptorInfo={descriptorInfo}
              descriptorError={descriptorError}
              importDescriptor={importDescriptor}
              signedPsbt={signedPsbt}
              setSignedPsbt={setSignedPsbt}
              offlineProofFormat={offlineProofFormat}
              selectOfflineProofFormat={selectOfflineProofFormat}
              prepareOfflineProof={prepareOfflineProof}
              prepareManualProof={prepareManualProof}
              selectAutomaticDesktop={selectAutomaticDesktop}
              submitManualProof={submitManualProof}
              signPreparedPsbt={signPreparedPsbt}
              connectLedgerUsb={connectLedgerUsb}
              ledgerAccount={ledgerAccount}
              setLedgerAccount={setLedgerAccount}
              ledgerStatus={ledgerStatus}
              ledgerBusy={ledgerBusy}
              ledgerUsbAvailability={ledgerUsbAvailability}
              connectTrezorUsb={connectTrezorUsb}
              trezorAccount={trezorAccount}
              setTrezorAccount={setTrezorAccount}
              trezorStatus={trezorStatus}
              trezorBusy={trezorBusy}
              trezorUsbAvailability={trezorUsbAvailability}
              connectJadeUsb={connectJadeUsb}
              prepareJadeQrProof={prepareJadeQrProof}
              acceptJadeAccountQr={acceptJadeAccountQr}
              acceptJadeQrSignature={acceptJadeQrSignature}
              submitJadeQrProof={submitJadeQrProof}
              jadeAccount={jadeAccount}
              setJadeAccount={setJadeAccount}
              jadeStatus={jadeStatus}
              jadeBusy={jadeBusy}
              jadeUsbAvailability={jadeUsbAvailability}
              jadeQrPayload={jadeQrPayload}
              jadeQrPath={jadeQrPath}
              jadeQrAccountInfo={jadeQrAccountInfo}
              walletConnected={Boolean(connectedAddress)}
              canDirectSign={Boolean(walletProfile?.capabilities?.supportsPsbt)}
              connectDirectSigner={connectWallet}
              mobileEntry={mobileEntry}
              mobileDevice={mobileDevice}
              walletInAppBrowser={walletInAppBrowser || (mobileDevice && injectedWallets.length > 0)}
              mobileHandoffUrl={mobileHandoffUrl}
              authMode={authMode}
              onPasswordLogin={handlePasswordLogin}
              onPasswordRecovery={() => setPasswordRecoveryRequested(true)}
              onUseWallet={() => setPasswordRecoveryRequested(false)}
            />
          )}

          <Suspense fallback={<ScreenFallback />}>
          {step === 'game' && (
            <GameStep
              shellsAvailable={shellsAvailable}
              onStartGame={handleStartGame}
              onBack={handleGameBack}
              loading={loading}
              error={error}
            />
          )}

          {(step === 'social' || step === 'authorized') && (
            <SocialStep
              address={address}
              onPublishMessage={handlePublishMessage}
              onLoadMessages={loadMessages}
              onLoadComments={loadComments}
              onToggleUseful={toggleUseful}
              onRepostMessage={repostMessage}
              onForYouNotInterested={hideForYouMessage}
              onEditorialPreference={handleEditorialPreference}
              onReportMessage={reportMessage}
              onLoadOpinionTopics={loadOpinionTopics}
              onSetPrivateStance={savePrivateTopicStance}
              loading={loading}
              error={error}
              onUserClick={(bitcoinAddress) => handleOpenProfile(bitcoinAddress, 'social')}
              onOpenOwnProfile={() => handleOpenProfile(authenticatedAddress, 'social')}
              onOpenGame={handleGameToPlay}
              onOpenCanvas={handleStartCanvas}
              onShowHistory={handleShowHistory}
              onShowStats={handleShowStats}
              onSync={manualSync}
              followingAddresses={followingAddresses}
              onFollowToggle={handleToggleFollow}
              isFollowing={isFollowing}
              defaultFeed={userPreferences.defaultFeed}
            />
          )}

          {step === 'profile' && profileAddress && (
            <ProfileStep
              profileAddress={profileAddress}
              currentAddress={authenticatedAddress}
              onBack={handleProfileBack}
              onOpenProfile={(bitcoinAddress) => handleOpenProfile(bitcoinAddress, 'profile')}
              onToggleFollow={handleToggleFollow}
              isFollowing={isFollowing}
              onShowStats={handleShowStats}
              passwordConfigured={passwordConfigured}
              onAddPassword={handleAddPassword}
              showFullAddress={userPreferences.showFullAddress}
              onEditorialPreference={handleEditorialPreference}
              onReportMessage={reportMessage}
              onReportProfile={reportProfile}
            />
          )}

          {step === 'profile-setup' && profileSetupAddress && (
            <ProfileSetupStep
              address={profileSetupAddress}
              btcBalance={btcBalance}
              onComplete={handleProfileSetupComplete}
              loading={loading}
              error={error}
            />
          )}

          {step === 'password-setup' && address && (
            <PasswordSetupStep
              address={address}
              mode={passwordSetupMode}
              onComplete={handlePasswordSetupComplete}
              onSkip={handlePasswordSetupSkip}
            />
          )}

          {step === 'settings' && address && (
            <SettingsStep
              address={address}
              passwordConfigured={passwordConfigured}
              preferences={userPreferences}
              onPreferencesChange={handlePreferencesChange}
              onLoadEditorialPreferences={loadEditorialAuthorPreferences}
              onEditorialPreference={handleEditorialPreference}
              onAddPassword={handleAddPassword}
              onBack={handleSettingsBack}
            />
          )}

          {step === 'canvas' && (
            <CanvasStep
              address={address}
              shellsAvailable={shellsAvailable}
              onSubmitPixels={submitCanvasPixels}
              onLoadCanvas={loadCanvasPixels}
              onLoadUserPixelCount={loadUserPixelCount}
              loading={loading}
              error={error}
              onBack={handleCanvasBack}
            />
          )}
          </Suspense>
        </div>

        <Suspense fallback={null}>
          {showHistory && (
            <HistoryModal
              show={showHistory}
              onClose={() => setShowHistory(false)}
              messages={userMessages}
              onLoadMore={handleLoadMoreHistory}
              hasMore={hasMoreMessages}
            />
          )}

          {showStats && (
            <StatsModal
              stats={stats}
              onClose={() => setShowStats(false)}
            />
          )}
        </Suspense>

        {step !== 'connect' && <Footer />}
      </div>
      )}
    </div>
  );
};

export default BitcoinExclusiveAccess;
