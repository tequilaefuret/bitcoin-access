import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import ProgressBar from './components/ui/ProgressBar';
import ConnectStep from './components/steps/ConnectStep';
import VerifyStep from './components/steps/VerifyStep';
import DashboardStep from './components/steps/DashboardStep';
import SocialStep from './components/steps/SocialStep';
import GameStep from './components/steps/GameStep';
import HistoryModal from './components/ui/HistoryModal';
import StatsModal from './components/ui/StatsModal'; 
import EnvIndicator from './components/ui/EnvIndicator';
import { useBitcoinBalance } from './hooks/useBitcoinBalance';
import useReownWallet from './hooks/useReownWallet';
import {getUserData } from './supabaseClient';
import CanvasStep from './components/steps/CanvasStep';

const BitcoinExclusiveAccess = () => {
  const [step, setStep] = useState('connect');
  const [showHistory, setShowHistory] = useState(false);
  const [userMessages, setUserMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isTestMode, setIsTestMode] = useState(false); // 🆕 Mode test

  const {
    address,
    btcBalance,
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    setAddress,
    setError,
    checkBitcoinBalance,
    startGame,
    saveGameScore,
    publishMessage,
    loadMessages,
    loadUserMessages,
    manualSync,
    loadStats,
    submitCanvasPixels,
    loadCanvasPixels,
    loadUserPixelCount,
    socialAction
  } = useBitcoinBalance();

  const {
    connectedAddress,
    connectedWallet,
    modal,
    disconnectWallet,
  } = useReownWallet();

  // ===== HANDLER : DÉCONNEXION DÉTECTÉE =====
  const handleWalletDisconnected = useCallback(() => {
    console.log('🔌 Gestion de la déconnexion...');
    localStorage.removeItem('bitcoin_address');
    localStorage.removeItem('btc_auth_token');
    localStorage.removeItem('walletConnected');
    sessionStorage.setItem('disconnect_timestamp', Date.now().toString());
    setAddress(null);
    setStep('connect');
    setIsTestMode(false);
    setError('Votre wallet a été déconnecté. Veuillez vous reconnecter.');
  }, [setAddress, setError]);

  // ===== ÉCOUTER DÉCONNEXION WALLET =====
  useEffect(() => {
    if (!modal) return;

    const unsubscribe = modal.subscribeState((state) => {
      if (state.open === false && connectedAddress && step !== 'connect') {
        const isConnected = modal.getIsConnectedState();
        if (!isConnected) {
          handleWalletDisconnected();
        }
      }
    });

    return () => unsubscribe?.();
  }, [modal, connectedAddress, step, handleWalletDisconnected]);

  // ===== ÉCOUTER ÉVÉNEMENT DISCONNECT =====
  useEffect(() => {
    const handleStorageEvent = (e) => {
      if (e.key === 'disconnect_timestamp') {
        console.warn('⚠️ Événement déconnexion reçu');
        handleWalletDisconnected();
      }
    };

    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, [handleWalletDisconnected]);

  // ===== VÉRIFICATION SESSION AU CHARGEMENT =====
  useEffect(() => {
    const checkExistingSession = async () => {
      console.log('🔍 Vérification session existante...');
      
      try {
        const savedAddress = localStorage.getItem('bitcoin_address');
        
        if (!savedAddress) {
          console.log('ℹ️ Aucune session sauvegardée');
          setIsCheckingSession(false);
          return;
        }

        console.log('📋 Session trouvée:', savedAddress);

        if (modal) {
          // 🆕 Attendre plus longtemps pour être sûr (0,5 seconde au lieu de 500ms)
          await new Promise(resolve => setTimeout(resolve,500));
          
          const modalAddress = modal.getAddress();
          const isConnected = modal.getIsConnectedState();

          console.log('🔍 État wallet après attente:', { modalAddress, isConnected, savedAddress });

          // 🆕 LOGIQUE STRICTE : Bloquer si adresse différente OU si pas connecté du tout
          if (modalAddress && modalAddress !== savedAddress) {
            console.warn('⚠️ Adresse différente détectée');
            localStorage.removeItem('bitcoin_address');
            localStorage.removeItem('btc_auth_token');
            setIsCheckingSession(false);
            return;
          }

          // 🆕 Si pas d'adresse du tout après 1 seconde = vraie déconnexion
          if (!modalAddress) {
            console.warn('⚠️ Wallet non connecté après 1s → Vraie déconnexion');
            localStorage.removeItem('bitcoin_address');
            localStorage.removeItem('btc_auth_token');
            setIsCheckingSession(false);
            return;
          }

          // 🆕 Si adresse présente mais pas "isConnected", c'est OK (bug Reown parfois)
          if (modalAddress === savedAddress && !isConnected) {
            console.log('⚠️ Adresse détectée mais isConnected=false (état transitoire Reown)');
          }
        }

        const user = await getUserData(savedAddress);
        
        if (!user) {
          console.error('❌ Utilisateur non trouvé en DB');
          localStorage.removeItem('bitcoin_address');
          localStorage.removeItem('btc_auth_token');
          setIsCheckingSession(false);
          return;
        }

        if (!user.signature_proof?.verified) {
          console.warn('⚠️ Signature non vérifiée → Mode test');
          setIsTestMode(true);
          await checkBitcoinBalance(savedAddress);
          setStep('game');
          setIsCheckingSession(false);
          return;
        }

        console.log('✅ Session valide, restauration...');
        setAddress(savedAddress);
        await checkBitcoinBalance(savedAddress, user.signature_proof);
        setStep('authorized');
        console.log('🎯 Navigation → Dashboard');
        
      } catch (err) {
        console.error('❌ Erreur vérification session:', err);
        localStorage.removeItem('bitcoin_address');
        localStorage.removeItem('btc_auth_token');
      } finally {
        setIsCheckingSession(false);
      }
    };

    if (modal !== null) {
      checkExistingSession();
    }
  }, [modal, checkBitcoinBalance, setAddress]);

  // ===== HANDLER : PREMIER ÉCRAN =====
  const handleConnect = useCallback(() => {
    setError('');
    setStep('verify');
  }, [setError]);

  // ===== HANDLER : DÉCONNEXION MANUELLE =====
  const handleManualDisconnect = useCallback(async () => {
    console.log('👋 Déconnexion manuelle demandée');
    
    try {
      await disconnectWallet();
      localStorage.removeItem('bitcoin_address');
      localStorage.removeItem('btc_auth_token');
      setAddress(null);
      setStep('connect');
      setIsTestMode(false);
      console.log('✅ Déconnexion terminée');
    } catch (err) {
      console.error('❌ Erreur lors de la déconnexion:', err);
    }
  }, [disconnectWallet, setAddress]);

  // ===== HANDLER : VÉRIFICATION TERMINÉE =====
  const handleVerify = useCallback(async ({ address, signature, signatureVerified, isTestMode: testMode }) => {
    console.log('✅ Vérification terminée:', { address, signatureVerified, testMode });

    setError('');

    // 🆕 MODE TEST : Accès direct au réseau social sans signature
    if (testMode || !signatureVerified) {
      console.log('🧪 MODE TEST activé - Accès réseau social démo');
      
      try {
        // ✅ Important : NE PAS stocker l'adresse en mode test
        setAddress(null);
        
        // ✅ Charger le solde en mode test (stockage sessionStorage uniquement)
        await checkBitcoinBalance(address, null, true);
        
        // ✅ Rediriger vers 'social' (pas 'game')
        setStep('social');
      } catch (err) {
        console.error('❌ Erreur chargement mode test:', err);
        setError('Erreur lors du chargement du mode test');
      }
      return;
    }

    // MODE AUTHENTIFIÉ : Vérifier signature obligatoire
    if (!signatureVerified) {
      console.error('❌ FAILLE BLOQUÉE : Tentative d\'accès sans signature vérifiée');
      setError('⚠️ Signature cryptographique obligatoire pour accéder au réseau social.');
      setStep('verify');
      return;
    }
    
    // Vérifier cohérence adresse wallet/signature
    if (connectedAddress && connectedAddress !== address) {
      console.error('❌ FAILLE BLOQUÉE : Adresse différente détectée');
      setError('⚠️ L\'adresse connectée ne correspond pas à l\'adresse vérifiée.');
      setStep('verify');
      return;
    }
    
    // Authentification réussie
    try {
      setAddress(address);
      localStorage.setItem('bitcoin_address', address);
      console.log('💾 Session sauvegardée avec signature vérifiée');
      
      const user = await getUserData(address);
      
      if (user) {
        console.log('✅ Utilisateur chargé depuis BDD');
        console.log('💰 BTC:', user.btc_balance);
        console.log('💰 wBTC:', user.wbtc_balance);
        
        // Charger les balances en mode authentifié
        await checkBitcoinBalance(address, signature);
        
        // Rediriger vers dashboard
        setStep('authorized');
      } else {
        console.error('❌ Utilisateur non trouvé après création');
        setError('Erreur : utilisateur non trouvé après création');
      }
    } catch (err) {
      console.error('❌ Erreur:', err);
      setError('Erreur lors de la synchronisation');
    }
  }, [checkBitcoinBalance, setAddress, setError, connectedAddress]);

  // ===== HANDLER : DÉMARRER JEU (depuis Dashboard) =====
  const handleGameToPlay = useCallback(async () => {
    if (isTestMode) {
      console.log('🧪 Mode test : accès direct au jeu');
      setStep('game');
      return;
    }

    // Mode authentifié : vérifications
    try {
      const savedAddress = localStorage.getItem('bitcoin_address');
      
      if (!savedAddress) {
        throw new Error('Pas de session sauvegardée');
      }
      
      const user = await getUserData(savedAddress);
      
      if (!user?.signature_proof?.verified) {
        throw new Error('Signature non vérifiée');
      }
      
      if (modal && !modal.getIsConnectedState()) {
        throw new Error('Wallet déconnecté');
      }
      
      setStep('game');
      
    } catch (err) {
      console.error('❌ Vérification pré-jeu échouée:', err.message);
      setError('Votre session a expiré. Veuillez vous reconnecter.');
      setStep('verify');
      return;
    }

    if (modal && !modal.getIsConnectedState()) {
      try {
        console.warn('⚠️ Wallet déconnecté, tentative de reconnexion...');
        setError('');
        
        await modal.open();
        
        let attempts = 0;
        const maxAttempts = 30;
        
        const waitForConnection = setInterval(async () => {
          attempts++;
          
          if (modal) {
            const address = modal.getAddress();
            const isConnected = modal.getIsConnectedState();
            
            if (address && isConnected) {
              clearInterval(waitForConnection);
              console.log('✅ Reconnexion réussie');
              
              const savedAddress = localStorage.getItem('bitcoin_address');
              if (address === savedAddress) {
                setStep('game');
              } else {
                setError('⚠️ Adresse reconnectée différente. Veuillez utiliser la bonne adresse.');
                setStep('verify');
              }
            } else if (attempts >= maxAttempts) {
              clearInterval(waitForConnection);
              setError('Délai de reconnexion dépassé. Veuillez réessayer.');
            }
          }
        }, 1000);
        
      } catch (err) {
        setError('Erreur lors de l\'ouverture du wallet.');
      }
      return;
    }

    setError('');
    setStep('game');
  }, [modal, setError, isTestMode, setStep]);

  // ===== HANDLER : LANCER UNE PARTIE =====
  const handleStartGame = useCallback(async () => {
    // 🆕 En mode test, pas de débit
    if (isTestMode) {
      console.log('🧪 Mode test : lancement partie sans débit');
      return true; // Autoriser le jeu sans débit
    }

    // Mode authentifié : vérifications + débit
    try {
      const savedAddress = localStorage.getItem('bitcoin_address');
      
      if (!savedAddress) {
        throw new Error('Pas de session sauvegardée');
      }
      
      const user = await getUserData(savedAddress);
      
      if (!user?.signature_proof?.verified) {
        throw new Error('Signature non vérifiée');
      }
      
      if (modal && !modal.getIsConnectedState()) {
        throw new Error('Wallet déconnecté');
      }
      
      // ✅ APPELER la vraie fonction startGame qui débite les wBTC
      return await startGame();
      
    } catch (err) {
      console.error('❌ Vérification pré-jeu échouée:', err.message);
      setError('Votre session a expiré. Veuillez vous reconnecter.');
      setStep('verify');
      throw err;
    }
  }, [startGame, modal, setError, setStep, isTestMode]);

  // ===== HANDLER : RETOUR DEPUIS JEU =====
  const handleGameBack = useCallback(() => {
    setError('');
    
    // 🆕 En mode test, retour à verify
    if (isTestMode) {
      setStep('verify');
    } else {
      setStep('authorized');
    }
  }, [setError, isTestMode, setStep]);

  // ===== HANDLER : PUBLICATION MESSAGE =====
  const handlePublishMessage = useCallback(async (content) => {
    try {
      const savedAddress = localStorage.getItem('bitcoin_address');
      
      if (!savedAddress) {
        throw new Error('Pas de session sauvegardée');
      }
      
      const user = await getUserData(savedAddress);
      
      if (!user?.signature_proof?.verified) {
        throw new Error('Signature non vérifiée');
      }
      
      if (modal && !modal.getIsConnectedState()) {
        throw new Error('Wallet déconnecté');
      }
      
      return await publishMessage(content);
      
    } catch (err) {
      console.error('❌ Vérification pré-publication échouée:', err.message);
      setError('Votre session a expiré. Veuillez vous reconnecter.');
      handleManualDisconnect();
      return false;
    }
  }, [publishMessage, modal, setError, handleManualDisconnect]);

  // ===== HANDLER : CANVAS - Navigation =====
  const handleStartCanvas = useCallback(() => {
    setError('');
    setStep('canvas');
  }, [setError]);

  const handleCanvasBack = useCallback(() => {
    setError('');
    setStep('authorized');
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
    if (isTestMode) {
      setError('Les statistiques ne sont pas disponibles en mode test');
      return;
    }

    const userStats = await loadStats();
    setStats(userStats);
    setShowStats(true);
  }, [loadStats, isTestMode, setError]);

  // ===== ÉCRAN DE CHARGEMENT =====
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Vérification de la session...</p>
        </div>
      </div>
    );
  }

  // ===== RENDU PRINCIPAL =====
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 p-4">
      <EnvIndicator />
      
      <div className="max-w-4xl mx-auto">
        <Header 
          connectedAddress={connectedAddress}
          connectedWallet={connectedWallet}
          onDisconnect={handleManualDisconnect}
          isTestMode={isTestMode}
        />

        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <ProgressBar currentStep={step} isTestMode={isTestMode} />

          {step === 'connect' && (
            <ConnectStep 
              onConnect={handleConnect}
              loading={loading}
              error={error}
            />
          )}

          {step === 'verify' && (
            <VerifyStep
              onVerified={handleVerify}
            />
          )}

          {step === 'authorized' && (
            <DashboardStep
              address={address}
              btcBalance={btcBalance}
              wbtcAvailable={wbtcAvailable}
              wbtcSpentTotal={wbtcSpentTotal}
              onStartGame={handleGameToPlay}
              onPublishMessage={() => setStep('social')} 
              onSync={manualSync}
              onShowHistory={handleShowHistory}
              onShowStats={handleShowStats}
              onStartCanvas={handleStartCanvas}
              isTestMode={isTestMode}
              loading={loading}
              error={error}
            />
          )}

          {step === 'game' && (
            <GameStep
              wbtcAvailable={wbtcAvailable}
              onStartGame={handleStartGame}
              onUpdateScore={saveGameScore}
              onBack={handleGameBack}
              loading={loading}
              error={error}
              isTestMode={isTestMode}
            />
          )}

          {step === 'social' && (
            <SocialStep
              isTestMode={!address}
              address={address}
              wbtcAvailable={wbtcAvailable}
              onPublishMessage={handlePublishMessage}
              onLoadMessages={loadMessages}
              onSocialAction={socialAction}
              loading={loading}
              error={error}
              onBack={() => setStep('authorized')}
            />
          )}

          {step === 'canvas' && (
            <CanvasStep
              address={address}
              wbtcAvailable={wbtcAvailable}
              onSubmitPixels={submitCanvasPixels}
              onLoadCanvas={loadCanvasPixels}
              onLoadUserPixelCount={loadUserPixelCount}
              loading={loading}
              error={error}
              onBack={handleCanvasBack}
            />
          )}
        </div>

        <HistoryModal
          show={showHistory}
          onClose={() => setShowHistory(false)}
          messages={userMessages}
          onLoadMore={handleLoadMoreHistory}
          hasMore={hasMoreMessages}
        />

        {showStats && (
          <StatsModal
            stats={stats}
            onClose={() => setShowStats(false)}
          />
        )}

        <Footer />
      </div>
    </div>
  );
};

export default BitcoinExclusiveAccess;