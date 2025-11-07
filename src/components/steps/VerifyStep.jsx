import React, { useState, useCallback } from 'react';
import { KeyRound, ArrowRight, Loader, Shield, CheckCircle2, TestTube } from 'lucide-react';
import useReownWallet from '../../hooks/useReownWallet';
import { verifyAndRegister, getUserData } from '../../supabaseClient';

export default function VerifyStep({ onVerified }) {
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [verificationStep, setVerificationStep] = useState('idle');
  const [isCheckingDB, setIsCheckingDB] = useState(false);
  const [hasCheckedDB, setHasCheckedDB] = useState(false); // 🆕 Flag pour éviter double vérification

  const {
    signMessage,
    isConnecting,
    error: walletError,
    modal
  } = useReownWallet();

  // ===== FONCTION 1 : Vérifier signature en DB et rediriger =====
  const checkSignatureAndRedirect = useCallback(async (address) => {
    // 🆕 Vérifier qu'il y a une vraie session stockée
    const hasStoredSession = localStorage.getItem('walletConnected') === 'true';
    if (!hasStoredSession) {
      console.log('⚠️ Pas de session stockée, ignorer auto-connexion');
      return false;
    }
    
    try {
      console.log('🔍 Vérification signature en DB pour:', address);
      
      const user = await getUserData(address);

      if (user?.signature_proof?.verified) {
        console.log('✅ Signature déjà en DB → Direct au Dashboard sans re-signer');
        
        setVerificationStep('verifying'); // 🆕 Passer en mode vérification
        
        onVerified({
          address: user.bitcoin_address,
          balance: user.btc_balance,
          method: 'wallet',
          signature: user.signature_proof,
          signatureVerified: true
        });
        
        return true;
      } else {
        console.log('ℹ️ Pas de signature en DB (normal pour nouvelle adresse)');
        return false;
      }
    } catch (err) {
      console.log('⚠️ Erreur vérification DB:', err.message);
      return false;
    }
  }, [onVerified]);

  // ===== FONCTION 2 : Flux de signature =====
  const handleSignatureFlow = useCallback(async (address) => {
    console.log('🔐 ÉTAPE 1 : Demande de signature pour', address);
    setError('');
    setVerificationStep('signing');

    try {
      const signature = await signMessage(address);

      if (!signature) {
        throw new Error('Signature non reçue');
      }

      console.log('✅ Signature obtenue:', signature);

      setVerificationStep('verifying');
      await handleWalletVerification(address, signature);

    } catch (err) {
      console.error('❌ Erreur lors de la signature:', err);
      setVerificationStep('idle');
      setHasCheckedDB(false);
      
      if (err.message.includes('refusée') || err.message.includes('rejected')) {
        setError('Signature refusée. Vous devez signer le message pour prouver que vous possédez cette adresse.');
      } else if (err.message.includes('not supported')) {
        setError('Votre wallet ne supporte pas la signature de messages.');
      } else {
        setError(`Erreur : ${err.message}`);
      }
    }
  }, [signMessage, setError, setVerificationStep, setHasCheckedDB, handleWalletVerification]);

  // ===== FONCTION 3 : Vérification finale =====
  const handleWalletVerification = useCallback(async (address, signatureData) => {    try {
      console.log('🔐 ÉTAPE 2 : Vérification cryptographique');
      console.log('📦 Données reçues:', signatureData);

      // 🆕 Extraire les bonnes valeurs selon la structure
      const finalAddress = signatureData.address || address;
      const finalMessage = signatureData.message;
      const finalSignature = signatureData.signature?.signature || signatureData.signature;
      
      // Déterminer le réseau
      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';

      console.log('📤 Envoi à verifyAndRegister:', {
        address: finalAddress,
        message: finalMessage?.substring(0, 50) + '...',
        signature: finalSignature?.substring(0, 20) + '...',
        network
      });

      const verifyResponse = await verifyAndRegister({
        address: finalAddress,
        message: finalMessage,
        signature: finalSignature,
        network
      });

      if (!verifyResponse.success && !verifyResponse.valid) {
        throw new Error(verifyResponse.error || 'Signature invalide');
      }

      console.log('✅ Signature valide ! Utilisateur créé/mis à jour');

      const userData = verifyResponse.user;

      localStorage.setItem('walletConnected', 'true');
      
      onVerified({
        address: userData.bitcoin_address,
        balance: userData.btc_balance,
        method: 'wallet',
        signature: userData.signature_proof,
        signatureVerified: true
      });

    } catch (err) {
      console.error('❌ Vérification échouée:', err);
      setVerificationStep('idle');
      setError(`❌ ${err.message}`);
    }
  }, [onVerified, setVerificationStep, setError]);

  // ===== HANDLER : Connexion Wallet =====
  const handleWalletConnect = useCallback(async () => {
    setError('');
    
    if (!modal) {
      setError('Modal non initialisé. Veuillez recharger la page.');
      return;
    }

    const address = modal.getAddress();
    const isConnected = modal.getIsConnectedState();

    if (address && isConnected) {
      console.log('✅ Wallet déjà connecté:', address);
      
      // 🆕 Éviter double vérification
      if (hasCheckedDB) {
        console.log('⚠️ Vérification DB déjà effectuée, affichage bouton signature');
        return;
      }
      
      setIsCheckingDB(true);
      setHasCheckedDB(true);
      
      const alreadySigned = await checkSignatureAndRedirect(address);
      
      // 🆕 Garder le loader si redirection en cours
      if (!alreadySigned) {
        setIsCheckingDB(false);
        // 🆕 Déclencher automatiquement la signature
        await handleSignatureFlow(address);
      }
      
      return;
    }

    console.log('🔌 Ouverture du modal de connexion...');
    setVerificationStep('connecting');

    try {
      await modal.open();

      let hasConnected = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      const checkInterval = setInterval(async () => {
        attempts++;
        
        if (modal) {
          const address = modal.getAddress();
          const connected = modal.getIsConnectedState();
          
          if (address && connected && !hasConnected) {
            console.log('🎉 Nouvelle connexion réussie:', address);
            hasConnected = true;
            clearInterval(checkInterval);
            
            setIsCheckingDB(true);
            setHasCheckedDB(true);
            
            const userData = await getUserData(address);
            
            if (userData?.signature_proof?.verified) {
              console.log('✅ Signature déjà en DB → Direct au Dashboard');
              
              localStorage.setItem('walletConnected', 'true');

              // 🆕 Garder isCheckingDB=true jusqu'à redirection
              onVerified({
                address: userData.bitcoin_address,
                balance: userData.btc_balance,
                method: 'wallet',
                signature: userData.signature_proof,
                signatureVerified: true
              });
              return;
            } else {
              console.log('🆕 Nouvelle adresse → Demander signature');
              setIsCheckingDB(false);
              // 🆕 Déclencher automatiquement la signature
              await handleSignatureFlow(address);
            }
            return;
          }
          
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            if (!hasConnected) {
              setVerificationStep('idle');
              setError('Délai de connexion dépassé. Veuillez réessayer.');
            }
          }
        }
      }, 1000);

    } catch (err) {
      console.error('❌ Erreur ouverture modal:', err);
      setVerificationStep('idle');
      setError('Erreur lors de l\'ouverture du wallet.');
    }
  }, [modal, checkSignatureAndRedirect, onVerified, hasCheckedDB, handleSignatureFlow]);

  // ===== HANDLER : Saisie Manuelle (Mode Test) =====
  const handleManualVerify = async () => {
    if (!manualAddress.trim()) {
      setError('Veuillez entrer une adresse Bitcoin valide');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      console.log('🧪 MODE TEST : Vérification adresse manuelle', manualAddress);

      // Vérifier le format de l'adresse
      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const isMainnet = bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet';
      
      const validPrefixes = isMainnet 
        ? ['bc1', '1', '3'] 
        : ['tb1', 'bcrt1', 'm', 'n', '2'];
      
      const isValidFormat = validPrefixes.some(prefix => manualAddress.startsWith(prefix));
      
      if (!isValidFormat) {
        throw new Error(`Adresse invalide pour le réseau ${isMainnet ? 'mainnet' : 'testnet'}`);
      }

      // Transmettre au parent en mode TEST (sans signature)
      onVerified({
        address: manualAddress,
        balance: 0,
        method: 'manual',
        signature: null,
        signatureVerified: false,
        isTestMode: true
      });

    } catch (err) {
      console.error('❌ Erreur vérification manuelle:', err);
      setError(err.message || 'Erreur lors de la vérification de l\'adresse');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <KeyRound className="w-20 h-20 text-orange-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Vérification Bitcoin</h2>
        <p className="text-gray-600">
          Connectez votre wallet pour accéder à votre espace personnel
        </p>
      </div>

      {!showManualInput ? (
        <>
          {/* 🆕 ENCART : Vérification DB */}
          {isCheckingDB && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-3">
                <Loader className="w-5 h-5 animate-spin text-blue-600" />
                <span className="font-medium text-blue-900">Connexion à l'adresse...</span>
              </div>
            </div>
          )}

          {/* MODE PRINCIPAL : Connexion Wallet */}
          {!isCheckingDB && verificationStep !== 'idle' && verificationStep !== 'connecting' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <div className={`flex items-center gap-3 ${
                verificationStep === 'signing' ? 'text-blue-600' : 'text-gray-300'
              }`}>
                {verificationStep === 'signing' ? (
                  <Loader className="w-5 h-5 animate-spin" />
                ) : verificationStep === 'verifying' ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
                )}
                <span className="font-medium">Signature du message</span>
              </div>

              <div className={`flex items-center gap-3 ${
                verificationStep === 'verifying' ? 'text-blue-600' : 'text-gray-300'
              }`}>
                {verificationStep === 'verifying' ? (
                  <Loader className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
                )}
                <span className="font-medium">Vérification cryptographique</span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleWalletConnect}
              disabled={isConnecting || !modal || isCheckingDB || (verificationStep !== 'idle' && verificationStep !== 'connecting')}
              className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-lg font-bold hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {!modal ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Initialisation...
                </>
              ) : isCheckingDB ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Vérification...
                </>
              ) : verificationStep === 'signing' || verificationStep === 'verifying' ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  {verificationStep === 'signing' ? 'Signature en cours...' : 'Vérification...'}
                </>
              ) : (() => {
                  const address = modal?.getAddress();
                  const isConnected = modal?.getIsConnectedState();
                  
                  return (address && isConnected && hasCheckedDB) ? (
                    <>
                      <Shield className="w-5 h-5" />
                      Signer le message
                    </>
                  ) : (
                    <>
                      <Shield className="w-5 h-5" />
                      Connecter mon wallet
                    </>
                  );
                })()}
            </button>

            {/* Lien discret pour le mode test */}
            <div className="text-center">
              <button
                onClick={() => setShowManualInput(true)}
                className="text-sm text-gray-500 hover:text-orange-600 underline flex items-center gap-1 mx-auto"
              >
                <TestTube className="w-4 h-4" />
                Vous n'avez pas de wallet ? Testez quand même
              </button>
            </div>

            {(error || walletError) && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm whitespace-pre-line">
                {error || walletError}
              </div>
            )}

            <div className="p-4 bg-green-50 rounded-lg space-y-3 border border-green-200">
              <p className="text-sm font-semibold text-green-900 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Comment ça fonctionne ?
              </p>
              <ul className="text-sm text-green-800 space-y-2">
                <li className="flex gap-2">
                  <span>•</span>
                  <span>Vous connectez votre wallet Bitcoin (Xverse, Leather, OKX, Phantom...)</span>
                </li>
                <li className="flex gap-2">
                  <span>•</span>
                  <span>Vous signez un message pour prouver que vous possédez l'adresse</span>
                </li>
                <li className="flex gap-2">
                  <span>•</span>
                  <span>Votre signature est vérifiée cryptographiquement</span>
                </li>
                <li className="flex gap-2">
                  <span>•</span>
                  <span>Votre solde BTC est converti en wBTC pour jouer</span>
                </li>
              </ul>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* MODE TEST : Saisie Manuelle */}
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
            <div className="flex items-start gap-3 mb-3">
              <TestTube className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-yellow-900 mb-1">Mode Test</h3>
                <p className="text-sm text-yellow-800">
                  Vous pouvez tester le site avec n'importe quelle adresse Bitcoin. 
                  Ce mode vous permet d'accéder au mini-jeu uniquement, sans vérification de propriété.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Adresse Bitcoin
              </label>
              <input
                type="text"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <button
              onClick={handleManualVerify}
              disabled={isVerifying || !manualAddress.trim()}
              className="w-full bg-orange-500 text-white py-3 rounded-lg font-bold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Vérification...
                </>
              ) : (
                <>
                  <ArrowRight className="w-5 h-5" />
                  Tester avec cette adresse
                </>
              )}
            </button>

            <button
              onClick={() => {
                setShowManualInput(false);
                setManualAddress('');
                setError('');
              }}
              className="w-full text-gray-600 py-2 hover:text-gray-800"
            >
              ← Retour à la connexion wallet
            </button>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}