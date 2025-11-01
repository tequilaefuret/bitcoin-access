import { useState, useCallback, useEffect, useRef } from 'react';
import { createAppKit } from '@reown/appkit';
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin';
import { bitcoin, bitcoinTestnet } from '@reown/appkit/networks';

// ✅ SINGLETON GLOBAL : Une seule instance du modal pour toute l'application
let globalModalInstance = null;
let globalModalInitializing = false;

/**
 * Hook personnalisé pour gérer la connexion Bitcoin via Reown AppKit
 * Utilise un singleton global pour éviter les doubles initialisations
 */

export default function useReownWallet() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(globalModalInstance);
  const [connectedAddress, setConnectedAddress] = useState(null);
  const [connectedWallet, setConnectedWallet] = useState(null);
  
  const hasCheckedConnection = useRef(false);

  /**
   * Initialise le modal Reown AppKit (SINGLETON)
   */
  useEffect(() => {
    const initializeModal = async () => {
      // ✅ Si déjà initialisé globalement, réutiliser l'instance
      if (globalModalInstance) {
        setModal(globalModalInstance);
        return;
      }

      // ✅ Si en cours d'initialisation, attendre
      if (globalModalInitializing) {
        console.log('⏳ Initialisation déjà en cours, attente...');
        const checkInterval = setInterval(() => {
          if (globalModalInstance) {
            setModal(globalModalInstance);
            clearInterval(checkInterval);
          }
        }, 100);
        return;
      }

      // ✅ Première initialisation
      globalModalInitializing = true;
      
      try {
        const projectId = process.env.REACT_APP_WALLETCONNECT_PROJECT_ID;
        
        if (!projectId) {
          console.error('⚠️ Project ID manquant dans .env.local');
          setError('Configuration manquante (Project ID)');
          globalModalInitializing = false;
          return;
        }

        // 🆕 DÉTECTION RÉSEAU BASÉE SUR BITCOIN_NETWORK (plus fiable que ENVIRONMENT)
        const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
        // ⚠️ Accepter 'bitcoin' OU 'mainnet' comme valeurs pour mainnet
        const isMainnet = bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet';
        
        console.log('🌐 Configuration réseau AppKit:', {
          BITCOIN_NETWORK: bitcoinNetwork,
          isMainnet: isMainnet,
          network: isMainnet ? 'bitcoin (mainnet)' : 'bitcoinTestnet'
        });

        // 🆕 IMPORTANT : Ne proposer QUE le réseau approprié
        // Cela force Leather à utiliser le bon réseau
        const networks = isMainnet ? [bitcoin] : [bitcoinTestnet];

        const metadata = {
          name: 'Bitcoin Exclusive Access',
          description: 'Prouvez votre détention de Bitcoin pour accéder au jeu',
          url: window.location.origin,
          icons: ['https://avatars.githubusercontent.com/u/37784886']
        };

        const bitcoinAdapter = new BitcoinAdapter({ projectId });

        const appKitModal = createAppKit({
          adapters: [bitcoinAdapter],
          networks, // 🆕 Un seul réseau selon environnement
          projectId,
          metadata,
          features: {
            analytics: false,
            email: false,
            socials: false
          },
          defaultNetwork: isMainnet ? bitcoin : bitcoinTestnet, // 🆕 Basé sur BITCOIN_NETWORK
          enableCoinbase: false,
          enableInjected: true,
          enableWalletConnect: true
        });

        // Écouter les changements d'état
        appKitModal.subscribeState((state) => {
          if (!state.open && state.selectedNetworkId && !hasCheckedConnection.current) {
            hasCheckedConnection.current = true;
            
            setTimeout(() => {
              try {
                const address = appKitModal.getAddress();
                const caipAddress = appKitModal.getCaipAddress();

                if (address || caipAddress) {
                  const finalAddress = address || (caipAddress ? caipAddress.split(':').pop() : null);
                  console.log('✅ Adresse connectée:', finalAddress);
                  
                  // 🆕 VÉRIFICATION RÉSEAU DE L'ADRESSE
                  const addressNetwork = finalAddress.startsWith('bc1') || 
                                        finalAddress.startsWith('1') || 
                                        finalAddress.startsWith('3')
                    ? 'mainnet'
                    : 'testnet';
                  
                  const expectedNetwork = isMainnet ? 'mainnet' : 'testnet';
                  
                  if (addressNetwork !== expectedNetwork) {
                    console.error('❌ Mauvais réseau détecté !');
                    console.error('Attendu:', expectedNetwork);
                    console.error('Adresse:', addressNetwork);
                    
                    setError(
                      `Mauvais réseau !\n\n` +
                      `Ce site nécessite une connexion sur le réseau ${expectedNetwork} de Bitcoin.\n` +
                      `Votre wallet est actuellement paramétré sur le réseau ${addressNetwork}.\n\n` +
                      `Veuillez changer de réseau dans votre wallet avant de vous connecter.`
                    );
                    
                    // Déconnecter automatiquement
                    appKitModal.disconnect();
                    return;
                  }
                  
                  setConnectedAddress(finalAddress);
                  setConnectedWallet('bitcoin');
                }
              } catch (err) {
                console.error('❌ Erreur récupération adresse:', err);
              }
              
              setTimeout(() => {
                hasCheckedConnection.current = false;
              }, 3000);
            }, 300);
          }
        });

        // ✅ Sauvegarder dans le singleton global
        globalModalInstance = appKitModal;
        setModal(appKitModal);
        globalModalInitializing = false;
        
        console.log('✅ Reown AppKit initialisé (SINGLETON)');

      } catch (err) {
        console.error('❌ Erreur initialisation Reown:', err);
        setError('Impossible d\'initialiser WalletConnect');
        globalModalInitializing = false;
      }
    };

    initializeModal();

    // ✅ PAS de cleanup ici pour garder le singleton en vie
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Ouvre le modal de connexion
   */
  const connectWallet = useCallback(async () => {
    setError('');
    setIsConnecting(true);

    try {
      if (!modal) {
        throw new Error('Modal non initialisé. Rechargez la page.');
      }
      
      hasCheckedConnection.current = false;
      
      await modal.open();
      setIsConnecting(false);
      
      return null;

    } catch (err) {
      console.error('❌ Erreur connexion wallet:', err);
      setError(err.message || 'Échec de la connexion');
      setIsConnecting(false);
      return null;
    }
  }, [modal]);

  /**
   * Demande une signature de message
   */
  const signMessage = useCallback(async (address) => {
    setError('');

    try {
      if (!modal) {
        throw new Error('Wallet non connecté');
      }

      const timestamp = Date.now();
      const message = `Prouver propriété de ${address}\nTimestamp: ${timestamp}`;

      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';

      console.log('🌐 Réseau pour signature:', network);
      console.log('📝 Message à signer:', message);
      console.log('📍 Adresse:', address);

      const addressNetwork = address.startsWith('bc1') || 
                            address.startsWith('1') || 
                            address.startsWith('3')
        ? 'mainnet'
        : 'testnet';

      if (addressNetwork !== network) {
        throw new Error(
          `Mauvais réseau détecté.\n\n` +
          `Ce site nécessite ${network}.\n` +
          `Votre wallet est en ${addressNetwork}.\n\n` +
          `Veuillez déconnecter et reconnecter avec le bon réseau.`
        );
      }

      const provider = await modal.getWalletProvider();
      
      if (!provider) {
        throw new Error('Provider non disponible');
      }

      let signature;
      
      // 🆕 DÉTECTION AMÉLIORÉE DES WALLETS
      // Ordre d'importance : Phantom > OKX > Autres
      
      // 1️⃣ PHANTOM WALLET (Priorité haute - détecté en premier)
      const isPhantom = window.phantom?.bitcoin !== undefined;
      
      // 2️⃣ OKX WALLET (Vérification stricte)
      const isOKX = (provider.isOkxWallet === true || 
                    window.okxwallet !== undefined) && 
                    !isPhantom; // Exclure Phantom

      console.log('🔍 Détection wallet:', {
        isPhantom,
        isOKX,
        providerName: provider.name
      });

      if (isPhantom) {
        console.log('👻 Phantom Wallet détecté, utilisation API native');
        
        try {
          const phantomProvider = window.phantom.bitcoin;
          
          // Vérifier que le compte est connecté
          const accounts = await phantomProvider.requestAccounts();
          
          if (!accounts || accounts.length === 0) {
            throw new Error('Aucun compte Phantom connecté');
          }
          
          console.log('📱 Comptes Phantom:', accounts);
          
          // 🆕 MÉTHODE CORRECTE POUR PHANTOM
          // Phantom attend : signMessage(address, message) 
          // où address est l'adresse publique (pas l'objet account)
          
          // Trouver le bon compte correspondant à l'adresse
          const account = accounts.find(acc => 
            acc.address === address || 
            acc.publicKey === address
          );
          
          if (!account) {
            console.warn('⚠️ Adresse non trouvée dans les comptes, utilisation directe');
          }
          
          console.log('📝 Signature avec adresse:', address);
          console.log('📝 Message:', message);
          console.log('🔍 DEBUG PHANTOM:');
          console.log('- phantomProvider exists:', !!phantomProvider);
          console.log('- signMessage exists:', typeof phantomProvider.signMessage);
          console.log('- address type:', typeof address, address);
          console.log('- message type:', typeof message, message);
          console.log('- message length:', message.length);
          
          // Appel API Phantom - syntaxe correcte
          const result = await phantomProvider.signMessage(address, message);
          
          // Phantom retourne { signature: string }
          if (result && result.signature) {
            signature = result.signature;
            console.log('✅ Signature Phantom reçue:', signature.substring(0, 20) + '...');
          } else {
            throw new Error('Format de réponse Phantom invalide');
          }
          
        } catch (err) {
          console.error('❌ Erreur signature Phantom:', err);
          
          // Log détaillé pour debug
          console.error('Détails erreur:', {
            message: err.message,
            code: err.code,
            stack: err.stack
          });
          
          if (err.message?.includes('User rejected') || err.code === 4001) {
            throw new Error('Signature refusée par l\'utilisateur');
          } else {
            throw new Error(`Phantom Wallet: ${err.message || 'Signature non supportée'}`);
          }
        }
      }
      else if (isOKX) {
        console.log('🟠 OKX Wallet détecté, utilisation API native');
        
        try {
          if (window.okxwallet && window.okxwallet.bitcoin) {
            // Détecter le type d'adresse pour OKX
            let addressType = 'segwit_native';
            
            if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
              addressType = 'taproot';
            } else if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
              addressType = 'segwit_native';
            } else if (address.startsWith('3') || address.startsWith('2')) {
              addressType = 'segwit_nested';
            } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
              addressType = 'legacy';
            }
            
            console.log('📍 Type adresse détecté:', addressType);
            
            signature = await window.okxwallet.bitcoin.signMessage(message, {
              from: address,
              type: addressType
            });
            
            console.log('✅ Signature OKX reçue');
          } else {
            throw new Error('API OKX Bitcoin non disponible');
          }
        } catch (err) {
          console.error('❌ Erreur signature OKX:', err);
          throw new Error('OKX Wallet: Signature refusée ou non supportée');
        }
      } 
      else {
        // 3️⃣ AUTRES WALLETS (Xverse, Leather, etc.)
        console.log('🔐 Wallet standard détecté, utilisation provider.request()');
        
        try {
          signature = await provider.request({
            method: 'personal_sign',
            params: [message, address],
            network: network
          });
          
          console.log('✅ Signature via personal_sign');
          
        } catch (err) {
          console.log('⚠️ personal_sign échoué, tentative signMessage...');
          
          try {
            signature = await provider.request({
              method: 'signMessage',
              params: {
                address: address,
                message: message,
                network: network
              }
            });
            
            console.log('✅ Signature via signMessage');
            
          } catch (err2) {
            console.log('⚠️ signMessage échoué, tentative stacks_signMessage...');
            
            signature = await provider.request({
              method: 'stacks_signMessage',
              params: {
                message: message,
                network: network
              }
            });
            
            console.log('✅ Signature via stacks_signMessage');
          }
        }
      }

      if (!signature) {
        throw new Error('Signature non reçue du wallet');
      }

      console.log('✅ Signature reçue');

      return {
        message: message,
        signature: signature,
        timestamp: timestamp,
        address: address
      };

    } catch (err) {
      console.error('❌ Erreur signature:', err);
      
      if (err.message?.includes('Mauvais réseau')) {
        setError(err.message);
        throw err;
      } else if (err.message?.includes('not supported') || err.message?.includes('MethodNotSupported')) {
        setError('Ce wallet ne supporte pas la signature de messages');
        throw new Error('Wallet non compatible');
      } else if (err.message?.includes('rejected') || err.message?.includes('User rejected')) {
        setError('Signature refusée par l\'utilisateur');
        throw new Error('Signature refusée');
      } else if (err.message?.includes('OKX') || err.message?.includes('Phantom')) {
        setError(err.message);
        throw err;
      } else {
        setError('Erreur lors de la signature');
        throw err;
      }
    }
  }, [modal]);

  /**
   * Déconnecte le wallet
   */
  const disconnectWallet = useCallback(async () => {
    if (modal) {
      try {
        await modal.disconnect();
        setConnectedAddress(null);
        setConnectedWallet(null);
        hasCheckedConnection.current = false;
        console.log('✅ Wallet déconnecté');
      } catch (err) {
        console.error('❌ Erreur déconnexion:', err);
      }
    }
  }, [modal]);

  /**
   * Récupère manuellement l'adresse connectée
   */
  const refreshConnectedAddress = useCallback(() => {
    if (!modal) return null;
    
    try {
      const address = modal.getAddress();
      const caipAddress = modal.getCaipAddress();
      
      if (address || caipAddress) {
        const finalAddress = address || (caipAddress ? caipAddress.split(':').pop() : null);
        setConnectedAddress(finalAddress);
        setConnectedWallet('bitcoin');
        return finalAddress;
      }
    } catch (err) {
      console.error('❌ Erreur refresh adresse:', err);
    }
    
    return null;
  }, [modal]);

  return {
    connectWallet,
    signMessage,
    disconnectWallet,
    refreshConnectedAddress,
    isConnecting,
    error,
    connectedAddress,
    connectedWallet,
    modal
  };
}