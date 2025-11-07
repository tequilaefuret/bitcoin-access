import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import ProgressBar from './components/ui/ProgressBar';
import ConnectStep from './components/steps/ConnectStep';
import VerifyStep from './components/steps/VerifyStep';
import DashboardStep from './components/steps/DashboardStep';
import GameStep from './components/steps/GameStep';
import HistoryModal from './components/modals/HistoryModal';
import StatsModal from './components/modals/StatsModal';
import EnvIndicator from './components/ui/EnvIndicator';
import { useBitcoinBalance } from './hooks/useBitcoinBalance';
import useReownWallet from './hooks/useReownWallet';
import {getUserData } from './supabaseClient';

const BitcoinExclusiveAccess = () => {
  const [step, setStep] = useState('connect');
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isTestMode, setIsTestMode] = useState(false); // 🆕 Mode test

  const {
    btcBalance,
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    setAddress,
    setError,
    checkBitcoinBalance,
    startGame,
    manualSync,
    loadHistory,
    loadStats,
    saveGameScore,
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
          console.warn('⚠️ WALLET DÉCONNECTÉ DÉTECTÉ');
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
          const modalAddress = modal.getAddress();
          const isConnected = modal.getIsConnectedState();

          if (!isConnected || !modalAddress || modalAddress !== savedAddress) {
            console.warn('⚠️ Wallet déconnecté ou adresse différente');
            localStorage.removeItem('bitcoin_address');
            localStorage.removeItem('btc_auth_token');
            setIsCheckingSession(false);
            return;
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

    // 🆕 MODE TEST : Accès direct au jeu sans signature
    if (testMode || !signatureVerified) {
      console.log('🧪 MODE TEST activé');
      setIsTestMode(true);
      
      try {
        setAddress(address);
        localStorage.setItem('bitcoin_address', address);
        await checkBitcoinBalance(address, null, true); // 🆕 passer isTestMode = true
        setStep('game');
      } catch (err) {
        console.error('❌ Erreur chargement mode test:', err);
        setError('Erreur lors du chargement du mode test');
      }
      return;
    }

    // MODE AUTHENTIFIÉ : Vérifier signature
    if (!signature?.verified) {
      console.error('❌ FAILLE BLOQUÉE : Tentative d\'accès sans signature vérifiée');
      setError('⚠️ Signature non vérifiée. Veuillez vous connecter avec votre wallet.');
      setStep('verify');
      return;
    }
    
    if (connectedAddress && connectedAddress !== address) {
      console.error('❌ FAILLE BLOQUÉE : Adresse différente détectée');
      setError('⚠️ L\'adresse connectée ne correspond pas à l\'adresse vérifiée.');
      setStep('verify');
      return;
    }
    
    try {
      setAddress(address);
      localStorage.setItem('bitcoin_address', address);
      console.log('💾 Session sauvegardée avec signature vérifiée');
      
      const user = await getUserData(address);
      
      if (user) {
        console.log('✅ Utilisateur chargé depuis BDD');
        await checkBitcoinBalance(address, signature);
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
  }, [modal, setError, isTestMode]);

  // ===== HANDLER : LANCER UNE PARTIE =====
  const handleStartGame = useCallback(async () => {
    // 🆕 En mode test, pas de vérification
    if (isTestMode) {
      console.log('🧪 Mode test : lancement partie sans vérification');
      return await startGame(true); // 🆕 passer isTestMode = true
    }

    // Mode authentifié : vérifications strictes
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
      
      return await startGame(false); // 🆕 passer isTestMode = false
      
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
  }, [setError, isTestMode]);

  // ===== HANDLER : HISTORIQUE =====
  const handleShowHistory = useCallback(async () => {
    if (isTestMode) {
      setError('L\'historique n\'est pas disponible en mode test');
      return;
    }

    const history = await loadHistory();
    setTransactions(history);
    setShowHistory(true);
  }, [loadHistory, isTestMode, setError]);

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
              btcBalance={btcBalance}
              wbtcAvailable={wbtcAvailable}
              wbtcSpentTotal={wbtcSpentTotal}
              onStartGame={handleGameToPlay}
              onSync={manualSync}
              onShowHistory={handleShowHistory}
              onShowStats={handleShowStats}
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
        </div>

        <HistoryModal
          show={showHistory}
          onClose={() => setShowHistory(false)}
          transactions={transactions}
        />

        <StatsModal
          show={showStats}
          onClose={() => setShowStats(false)}
          stats={stats}
        />

        <Footer />
      </div>
    </div>
  );
};

export default BitcoinExclusiveAccess;