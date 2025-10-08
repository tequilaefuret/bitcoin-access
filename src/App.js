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
import { supabase } from './supabaseClient';

const BitcoinExclusiveAccess = () => {
  const [step, setStep] = useState('connect');
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

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
    localStorage.removeItem('btc_address');
    sessionStorage.setItem('disconnect_timestamp', Date.now().toString());
    setAddress(null);
    setStep('connect');
    setError('Votre wallet a été déconnecté. Veuillez vous reconnecter.');
  }, [setAddress, setError]);

  // ===== EFFET : RECONNEXION AUTOMATIQUE AU CHARGEMENT =====
  useEffect(() => {
    let isMounted = true;
    
    const checkExistingSession = async () => {
      console.log('🔍 Vérification de session sauvegardée...');
      
      try {
        const savedAddress = localStorage.getItem('btc_address');
        
        if (!savedAddress) {
          console.log('❌ Pas de session sauvegardée → Page Connexion');
          if (isMounted) setIsCheckingSession(false);
          return;
        }
        
        console.log('✅ Session trouvée pour:', savedAddress);
        
        // ✅ VÉRIFICATION CRITIQUE : S'assurer que c'est une vraie session et pas un reste
        // Si on vient de se déconnecter, ne pas reconnecter
        const disconnectTimestamp = sessionStorage.getItem('disconnect_timestamp');
        const now = Date.now();
        
        if (disconnectTimestamp && (now - parseInt(disconnectTimestamp)) < 5000) {
          console.log('⚠️ Déconnexion récente détectée, ignorer localStorage');
          localStorage.removeItem('btc_address');
          sessionStorage.removeItem('disconnect_timestamp');
          if (isMounted) setIsCheckingSession(false);
          return;
        }

        const { data: user, error: dbError } = await supabase
          .from('user_balances')
          .select('*')
          .eq('bitcoin_address', savedAddress)
          .single();

        if (dbError || !user) {
          console.log('❌ Session expirée ou invalide en DB');
          localStorage.removeItem('btc_address');
          if (isMounted) setIsCheckingSession(false);
          return;
        }

        if (user.signature_proof?.verified) {
          console.log('✅ Signature vérifiée → Restauration Dashboard');
          
          if (isMounted) {
            setAddress(savedAddress);
            await checkBitcoinBalance(savedAddress);
            setStep('authorized');
          }
        } else {
          console.log('⚠️ Pas de signature vérifiée → Page Vérification');
          if (isMounted) {
            setStep('verify');
          }
        }

      } catch (err) {
        console.error('❌ Erreur vérification session:', err);
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    };

    const timer = setTimeout(() => {
      checkExistingSession();
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  // ===== EFFET : DÉTECTION RÉVOCATION WALLET =====
  useEffect(() => {
    if (!modal) return;

    const unsubscribe = modal.subscribeState((state) => {
      // ✅ Pour Leather, vérifier aussi via polling car les events ne marchent pas
      const checkConnection = () => {
        try {
          const isConnected = modal.getIsConnectedState();
          const currentAddress = modal.getAddress();
          
          console.log('🔍 État connexion:', { isConnected, currentAddress, connectedAddress, step });
          
          // Si on était connecté et qu'on ne l'est plus
          if (!isConnected && !currentAddress && connectedAddress && step !== 'connect') {
            console.warn('⚠️ Wallet révoqué détecté');
            handleWalletDisconnected();
          }
        } catch (err) {
          console.error('❌ Erreur vérification connexion:', err);
        }
      };
      
      checkConnection();
    });

    // ✅ Polling additionnel pour Leather (toutes les 2 secondes)
    const pollingInterval = setInterval(() => {
      if (connectedAddress && step !== 'connect') {
        try {
          const isConnected = modal.getIsConnectedState();
          const currentAddress = modal.getAddress();
          
          if (!isConnected && !currentAddress) {
            console.warn('⚠️ [POLLING] Déconnexion détectée');
            handleWalletDisconnected();
          }
        } catch (err) {
          // Ignorer les erreurs de polling
        }
      }
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(pollingInterval);
    };
  }, [modal, connectedAddress, step, handleWalletDisconnected]);

  // ===== HANDLER : DÉCONNEXION MANUELLE =====
  const handleManualDisconnect = async () => {
    try {
      console.log('🔌 Déconnexion manuelle initiée...');
      
      // ✅ ÉTAPE 1 : Nettoyer localStorage EN PREMIER
      localStorage.removeItem('btc_address');
      sessionStorage.setItem('disconnect_timestamp', Date.now().toString());
      console.log('🗑️ localStorage nettoyé');
      
      // ✅ ÉTAPE 2 : Nettoyer les états
      setAddress(null);
      setError('');
      console.log('🗑️ États nettoyés');
      
      // ✅ ÉTAPE 3 : Déconnecter le wallet Reown
      await disconnectWallet();
      console.log('🔌 Wallet Reown déconnecté');
      
      // ✅ ÉTAPE 4 : Forcer la redirection (avec un petit délai pour garantir le nettoyage)
      setTimeout(() => {
        setStep('connect');
        console.log('✅ Redirection vers page Connexion');
      }, 100);
      
    } catch (err) {
      console.error('❌ Erreur déconnexion:', err);
      
      // ✅ Forcer quand même la redirection même en cas d'erreur
      localStorage.removeItem('btc_address');
      setAddress(null);
      setStep('connect');
      setError('Déconnexion effectuée avec erreurs mineurs');
    }
  };

  // ===== HANDLERS DES ÉTAPES =====
  const handleConnect = useCallback(async () => {
    setError('');
    setTimeout(() => {
      setStep('verify');
    }, 1000);
  }, [setError]);

  const handleVerify = useCallback(async (data) => {
    console.log('✅ Vérification reçue:', data);
    
    const { address, signature, signatureVerified } = data;
    
    // ✅ CRITIQUE : Bloquer TOUT accès sans signature vérifiée
    if (!signatureVerified) {
      console.error('❌ FAILLE BLOQUÉE : Tentative d\'accès sans signature vérifiée');
      setError('⚠️ Signature cryptographique obligatoire pour accéder au jeu.');
      
      // Forcer retour à la page Vérification
      setStep('verify');
      return;
    }
    
    // ✅ Vérifier aussi que l'adresse connectée correspond
    if (connectedAddress && connectedAddress !== address) {
      console.error('❌ FAILLE BLOQUÉE : Adresse différente détectée');
      setError('⚠️ L\'adresse connectée ne correspond pas à l\'adresse vérifiée.');
      setStep('verify');
      return;
    }
    
    try {
      const success = await checkBitcoinBalance(address, signature);
      
      if (success) {
        setAddress(address);
        localStorage.setItem('btc_address', address);
        console.log('💾 Session sauvegardée avec signature vérifiée');
        setStep('authorized');
      } else {
        setError('Erreur lors de la création du compte');
      }
    } catch (err) {
      console.error('❌ Erreur synchro:', err);
      setError('Erreur lors de la synchronisation');
    }
  }, [checkBitcoinBalance, setAddress, setError, connectedAddress]);

  const handleStartGame = useCallback(async () => {
    // ✅ Vérifier signature en DB avant de lancer le jeu
    try {
      const savedAddress = localStorage.getItem('btc_address');
      
      if (!savedAddress) {
        throw new Error('Pas de session sauvegardée');
      }
      
      const { data: user } = await supabase
        .from('user_balances')
        .select('signature_proof')
        .eq('bitcoin_address', savedAddress)
        .single();
      
      if (!user?.signature_proof?.verified) {
        throw new Error('Signature non vérifiée');
      }
      
      // Vérifier aussi la connexion wallet
      if (modal && !modal.getIsConnectedState()) {
        throw new Error('Wallet déconnecté');
      }
      
      return await startGame();
      
    } catch (err) {
      console.error('❌ Vérification pré-jeu échouée:', err.message);
      setError('Votre session a expiré. Veuillez vous reconnecter.');
      localStorage.removeItem('btc_address');
      setStep('connect');
      return false;
    }
  }, [modal, startGame, setError]);

  const handleShowHistory = useCallback(async () => {
    const history = await loadHistory();
    setTransactions(history);
    setShowHistory(true);
  }, [loadHistory]);

  const handleShowStats = useCallback(async () => {
    const userStats = await loadStats();
    setStats(userStats);
    setShowStats(true);
  }, [loadStats]);

  const handleGameToPlay = useCallback(async () => {
    if (modal) {
      const isConnected = modal.getIsConnectedState();
      
      if (!isConnected) {
        console.warn('⚠️ Wallet déconnecté détecté au clic sur Jouer');
        
        // ✅ Rouvrir le modal SANS changer de page
        try {
          await modal.open();
          
          // ✅ Attendre la reconnexion avec polling
          let attempts = 0;
          const maxAttempts = 30; // 30 secondes max
          
          const waitForConnection = setInterval(async () => {
            attempts++;
            
            const address = modal.getAddress();
            const connected = modal.getIsConnectedState();
            
            console.log(`🔄 Tentative ${attempts}: connected=${connected}, address=${address}`);
            
            if (address && connected) {
              clearInterval(waitForConnection);
              
              // ✅ Vérifier si cette adresse a déjà signé
              try {
                const savedAddress = localStorage.getItem('btc_address');
                
                if (savedAddress === address) {
                  console.log('✅ Reconnexion réussie avec adresse connue');
                  
                  // Vérifier signature en DB
                  const { data: user } = await supabase
                    .from('user_balances')
                    .select('signature_proof')
                    .eq('bitcoin_address', address)
                    .single();
                  
                  if (user?.signature_proof?.verified) {
                    console.log('✅ Signature valide → Lancer le jeu');
                    setError('');
                    setStep('game');
                  } else {
                    setError('Signature manquante. Veuillez vous authentifier.');
                    setStep('verify');
                  }
                } else {
                  setError('Adresse différente détectée. Veuillez utiliser la bonne adresse.');
                  setStep('verify');
                }
              } catch (err) {
                setError('Erreur lors de la vérification. Réessayez.');
              }
            } else if (attempts >= maxAttempts) {
              clearInterval(waitForConnection);
              setError('Délai de reconnexion dépassé. Veuillez réessayer.');
            }
          }, 1000);
          
        } catch (err) {
          setError('Erreur lors de l\'ouverture du wallet.');
        }
        return;
      }
    }
    
    setError('');
    setStep('game');
  }, [modal, setError]);

  const handleGameBack = useCallback(() => {
    setError('');
    setStep('authorized');
  }, [setError]);

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
        />

        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <ProgressBar currentStep={step} />

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