import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, ArrowRight, AlertCircle, Loader, Shield, CheckCircle2 } from 'lucide-react';
import useReownWallet from '../../hooks/useReownWallet';
import { verifyAndRegister, getUserData } from '../../supabaseClient';

export default function VerifyStep({ onVerified }) {
  const [connectionMethod, setConnectionMethod] = useState(null);
  const [manualAddress, setManualAddress] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [verificationStep, setVerificationStep] = useState('idle');

  const {
    connectWallet,
    signMessage,
    isConnecting,
    error: walletError,
    modal
  } = useReownWallet();

  // ===== FONCTION 1 : Vérifier signature en DB et rediriger =====
  const checkSignatureAndRedirect = useCallback(async (address) => {
    try {
      console.log('🔍 Vérification signature en DB pour:', address);
      
      const user = await getUserData(address);

      if (user?.signature_proof?.verified) {
        console.log('✅ Signature déjà en DB → Direct au Dashboard sans re-signer');
        
        setVerificationStep('verifying');
        
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
  }, [onVerified, setVerificationStep]);

  // ===== FONCTION 2 : Flux de signature =====
  const handleSignatureFlow = async (address) => {
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
      
      if (err.message.includes('refusée') || err.message.includes('rejected')) {
        setError('❌ Signature refusée. Vous devez signer le message pour prouver que vous possédez cette adresse.');
      } else if (err.message.includes('not supported')) {
        setError('❌ Votre wallet ne supporte pas la signature de messages. Essayez avec Xverse ou Leather.');
      } else {
        setError(err.message || 'Erreur lors de la signature');
      }
    }
  };

  // ===== FONCTION 3 : Vérification solde + signature serveur =====
  const handleWalletVerification = async (address, signature) => {
    console.log('🟢 ÉTAPE 2 : Vérification du solde BTC pour', address);
    setIsVerifying(true);

    try {
      const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK || 'mainnet';
      
      console.log('🔐 Vérification signature serveur...');
      
      const verificationResult = await verifyAndRegister({
        address: address,
        message: signature.message,
        signature: signature.signature,
        network: networkConfig
      });

      if (!verificationResult.valid) {
        const errorMsg = verificationResult.error || 'Signature invalide';
        throw new Error(errorMsg);
      }

      console.log('✅ Signature vérifiée cryptographiquement côté serveur !');
      
      const confirmedBalanceBTC = verificationResult.user.btc_balance;
      console.log('💰 Solde confirmé:', confirmedBalanceBTC, 'BTC (depuis Edge Function)');
      
      if (verificationResult.user.signature_proof?.addressType) {
        console.log('📋 Type d\'adresse:', verificationResult.user.signature_proof.addressType);
      }

      onVerified({
        address: address,
        balance: confirmedBalanceBTC,
        method: 'wallet',
        signature: verificationResult.user.signature_proof,
        signatureVerified: true
      });

    } catch (err) {
      console.error('❌ Erreur vérification:', err);
      
      // Messages d'erreur améliorés
      if (err.message.includes('cryptographiquement') || err.message.includes('invalide')) {
        setError('❌ Signature invalide\n\n' + err.message);
      } else if (err.message.includes('Solde minimum')) {
        setError('💰 Solde insuffisant\n\n' + err.message);
      } else {
        setError(err.message || 'Impossible de vérifier l\'adresse.');
      }
      
      setVerificationStep('idle');
    } finally {
      setIsVerifying(false);
    }
  };

  // ===== EFFET : Détection wallet déjà connecté =====
  useEffect(() => {
    if (connectionMethod === null && modal) {
      const address = modal.getAddress();
      const isConnected = modal.getIsConnectedState();
      
      if (address && isConnected) {
        console.log('🎯 Wallet déjà connecté au chargement:', address);
        setConnectionMethod('wallet');
        checkSignatureAndRedirect(address);
      }
    }
  }, [connectionMethod, modal, checkSignatureAndRedirect]);

  // ===== EFFET : Redirection auto si wallet connecté + signature existe =====
  useEffect(() => {
    let isMounted = true;
    let hasChecked = false;
    
    const checkAndRedirect = async () => {
      if (hasChecked || !modal) return;
      
      if (connectionMethod === 'wallet' && verificationStep === 'idle') {
        const address = modal.getAddress();
        const isConnected = modal.getIsConnectedState();
        
        if (address && isConnected) {
          console.log('🔄 Wallet connecté détecté, vérification signature DB...');
          hasChecked = true;
          
          if (isMounted) {
            const hasSignature = await checkSignatureAndRedirect(address);
            
            if (!hasSignature) {
              console.log('ℹ️ Pas de signature, bouton "Signer le message" affiché');
            }
          }
        }
      }
    };
    
    const timer = setTimeout(checkAndRedirect, 300);
    
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [connectionMethod, verificationStep, modal, checkSignatureAndRedirect]);

  // ===== FONCTION 4 : Connexion wallet =====
  const handleWalletConnect = async () => {
    setError('');

    // CAS 1 : Wallet déjà connecté (reconnexion)
    if (modal) {
      const existingAddress = modal.getAddress();
      const isConnected = modal.getIsConnectedState();
      
      if (existingAddress && isConnected) {
        console.log('🔐 Wallet déjà connecté, vérification DB...');
        
        const userData = await getUserData(existingAddress);
        
        if (userData?.signature_proof?.verified) {
          console.log('✅ Signature déjà en DB → Direct au Dashboard');
          
          onVerified({
            address: userData.bitcoin_address,
            balance: userData.btc_balance,
            method: 'wallet',
            signature: userData.signature_proof,
            signatureVerified: true
          });
          return;
        } else {
          console.log('⚠️ Pas de signature → Demander signature');
          await handleSignatureFlow(existingAddress);
        }
        return;
      }
    }

    // CAS 2 : Nouvelle connexion
    setVerificationStep('connecting');

    try {
      await connectWallet();

      console.log('📱 Modal ouvert, attente connexion...');

      let hasConnected = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      const checkInterval = setInterval(async () => {
        attempts++;
        
        if (modal) {
          const address = modal.getAddress();
          const connected = modal.getIsConnectedState();
          
          // ✅ Connexion détectée
          if (address && connected && !hasConnected) {
            console.log('🎉 Nouvelle connexion réussie:', address);
            hasConnected = true;
            clearInterval(checkInterval);
            
            const userData = await getUserData(address);
            
            if (userData?.signature_proof?.verified) {
              console.log('✅ Signature déjà en DB → Direct au Dashboard');
              
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
              await handleSignatureFlow(address);
            }
            return;
          }
          
          // Timeout uniquement
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
      setError(walletError || 'Erreur lors de l\'ouverture du wallet');
      setVerificationStep('idle');
      console.error(err);
    }
  };

  // ===== FONCTION 5 : Vérification manuelle =====
  const handleManualVerify = async () => {
    setError('');
    
    const btcRegex = /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/;
    if (!btcRegex.test(manualAddress)) {
      setError('Adresse Bitcoin invalide');
      return;
    }

    setIsVerifying(true);

    try {
      const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK;
      let apiUrl;
      
      if (networkConfig === 'testnet4') {
        apiUrl = `https://mempool.space/testnet4/api/address/${manualAddress}`;
      } else if (networkConfig === 'testnet' || networkConfig === 'testnet3') {
        apiUrl = `https://mempool.space/testnet/api/address/${manualAddress}`;
      } else {
        apiUrl = `https://mempool.space/api/address/${manualAddress}`;
      }

      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Erreur API Mempool');
      
      const data = await response.json();
      const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      const confirmedBalanceBTC = confirmedBalance / 100000000;

      if (confirmedBalanceBTC < 0.000001) {
        setError('Solde minimum requis : 0.000001 BTC confirmé');
        setIsVerifying(false);
        return;
      }

      onVerified({
        address: manualAddress,
        balance: confirmedBalanceBTC,
        method: 'manual',
        signature: null
      });

    } catch (err) {
      setError('Impossible de vérifier l\'adresse. Réessayez plus tard.');
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  };

  // ===== RENDU : Choix de méthode =====
  if (!connectionMethod) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6 text-center">
          Comment souhaitez-vous vous connecter ?
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => setConnectionMethod('manual')}
            className="p-6 border-2 border-gray-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all group"
          >
            <KeyRound className="w-12 h-12 mx-auto mb-4 text-gray-600 group-hover:text-orange-500" />
            <h3 className="font-bold text-lg mb-2">Saisie manuelle</h3>
            <p className="text-sm text-gray-600">
              Entrez votre adresse Bitcoin manuellement
            </p>
            <p className="text-xs text-gray-500 mt-2">
              ✓ Simple et rapide<br />
              ⚠️ Sans preuve de propriété
            </p>
          </button>

          <button
            onClick={() => setConnectionMethod('wallet')}
            className="p-6 border-2 border-green-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all group relative"
          >
            <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-bold">
              RECOMMANDÉ
            </div>
            <Shield className="w-12 h-12 mx-auto mb-4 text-gray-600 group-hover:text-green-500" />
            <h3 className="font-bold text-lg mb-2">Connexion Wallet</h3>
            <p className="text-sm text-gray-600">
              Connectez votre wallet Bitcoin
            </p>
            <p className="text-xs text-green-600 mt-2 font-medium">
              ✓ Signature cryptographique<br />
              ✓ Preuve de propriété sécurisée
            </p>
          </button>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">Wallets compatibles :</p>
            <p>Xverse • Leather • OKX • Phantom</p>
            <p className="text-xs text-blue-600 mt-2">
              ✓ Tous types d'adresses supportés (Legacy, SegWit, Taproot)
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ===== RENDU : Saisie manuelle =====
  if (connectionMethod === 'manual') {
    return (
      <div className="max-w-md mx-auto p-6">
        <button
          onClick={() => setConnectionMethod(null)}
          className="text-sm text-gray-600 hover:text-gray-800 mb-4"
        >
          ← Retour au choix de méthode
        </button>

        <h2 className="text-2xl font-bold mb-6">Vérifiez votre adresse Bitcoin</h2>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-800">
            ⚠️ Sans signature cryptographique, vous ne pourrez pas prouver la propriété de l'adresse
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Adresse Bitcoin
            </label>
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="bc1... ou 1... ou 3..."
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              disabled={isVerifying}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm whitespace-pre-line">
              {error}
            </div>
          )}

          <button
            onClick={handleManualVerify}
            disabled={isVerifying || !manualAddress}
            className="w-full bg-orange-500 text-white py-3 rounded-lg font-bold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isVerifying ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Vérification...
              </>
            ) : (
              <>
                Vérifier mon solde
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Minimum requis : 0.000001 BTC confirmé (≥1 bloc)
          </p>
        </div>
      </div>
    );
  }

  // ===== RENDU : Connexion wallet =====
  if (connectionMethod === 'wallet') {
    return (
      <div className="max-w-md mx-auto p-6">
        <button
          onClick={() => {
            setConnectionMethod(null);
            setVerificationStep('idle');
          }}
          className="text-sm text-gray-600 hover:text-gray-800 mb-4"
          disabled={verificationStep !== 'idle'}
        >
          ← Retour au choix de méthode
        </button>

        <h2 className="text-2xl font-bold mb-6">Connexion Wallet Bitcoin</h2>

        {verificationStep !== 'idle' && (
          <div className="bg-white rounded-lg border-2 border-gray-200 p-4 mb-4 space-y-3">
            <div className={`flex items-center gap-3 ${
              verificationStep === 'connecting' ? 'text-blue-600' : 
              verificationStep === 'signing' || verificationStep === 'verifying' ? 'text-green-600' : 
              'text-gray-400'
            }`}>
              {verificationStep === 'connecting' ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : verificationStep === 'signing' || verificationStep === 'verifying' ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
              )}
              <span className="font-medium">Connexion au wallet</span>
            </div>

            <div className={`flex items-center gap-3 ${
              verificationStep === 'signing' ? 'text-blue-600' : 
              verificationStep === 'verifying' ? 'text-green-600' : 
              'text-gray-300'
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
            disabled={isConnecting || !modal || (verificationStep !== 'idle' && verificationStep !== 'connecting')}
            className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-lg font-bold hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {!modal ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Initialisation...
              </>
            ) : verificationStep === 'signing' || verificationStep === 'verifying' ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                {verificationStep === 'signing' ? 'Signature en cours...' : 'Vérification...'}
              </>
            ) : (() => {
                const address = modal?.getAddress();
                const isConnected = modal?.getIsConnectedState();
                
                return (address && isConnected) ? (
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
            <ol className="text-sm text-green-800 space-y-2 list-decimal list-inside">
              <li>Cliquez sur "Connecter mon wallet"</li>
              <li>Choisissez votre wallet (Xverse, Leather, OKX ou Phantom)</li>
              <li>Autorisez la connexion dans votre wallet</li>
              <li>Signez un message pour prouver la propriété</li>
              <li>Vérification automatique du solde BTC</li>
            </ol>
            <p className="text-xs text-green-700 mt-2 pt-2 border-t border-green-200">
              ✓ Tous les types d'adresses Bitcoin sont supportés : Legacy (1...), SegWit (bc1q...) et Taproot (bc1p...)
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}