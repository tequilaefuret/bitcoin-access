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

  // 🎯 STRATÉGIE PAR WALLET - Facile à étendre
  const WALLET_STRATEGIES = {
    phantom: {
      detect: () => window.phantom?.bitcoin?.isPhantom === true,
      sign: async (address, message) => {
        const provider = window.phantom.bitcoin;
        await provider.requestAccounts();
        
        // Phantom : encode message + convert signature
        const encoded = new TextEncoder().encode(message);
        const result = await provider.signMessage(address, encoded);
        
        // Convert Uint8Array to Base64
        const binString = String.fromCodePoint(...result.signature);
        return btoa(binString);
      }
    },
    
    okx: {
      detect: () => window.okxwallet?.bitcoin !== undefined,
      sign: async (address, message) => {
        const provider = window.okxwallet.bitcoin;
        
        // Detect address type
        let addressType = 'segwit_native';
        if (address.startsWith('bc1p') || address.startsWith('tb1p')) addressType = 'taproot';
        else if (address.startsWith('3') || address.startsWith('2')) addressType = 'segwit_nested';
        else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) addressType = 'legacy';
        
        return await provider.signMessage(message, { from: address, type: addressType });
      }
    }
  };

  /**
   * Demande une signature de message
   */
  const signMessage = useCallback(async (address) => {
    setError('');

    try {
      if (!modal) throw new Error('Wallet non connecté');

      const timestamp = Date.now();
      const message = `Prouver propriété de ${address}\nTimestamp: ${timestamp}`;
      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';

      console.log('🌐 Réseau:', network);
      console.log('📝 Message:', message);
      console.log('📍 Adresse:', address);

      // Vérif réseau
      const addressNetwork = address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3') ? 'mainnet' : 'testnet';
      if (addressNetwork !== network) {
        throw new Error(`Mauvais réseau. Attendu: ${network}, Détecté: ${addressNetwork}`);
      }

      const provider = await modal.getWalletProvider();
      if (!provider) throw new Error('Provider non disponible');

      let signature;
      
      // 🎯 DÉTECTION ET EXÉCUTION DE LA STRATÉGIE
      const walletStrategy = Object.entries(WALLET_STRATEGIES).find(([name, strategy]) => {
        const detected = strategy.detect();
        if (detected) console.log(`✅ ${name.toUpperCase()} détecté`);
        return detected;
      });

      if (walletStrategy) {
        const [walletName, strategy] = walletStrategy;
        try {
          signature = await strategy.sign(address, message);
          console.log(`✅ Signature ${walletName} reçue`);
        } catch (err) {
          console.error(`❌ Erreur ${walletName}:`, err);
          throw new Error(`${walletName}: ${err.message || 'Signature refusée'}`);
        }
      } else {
        // 🔄 FALLBACK : Wallets standard (Xverse, Leather, etc.)
        console.log('🔐 Wallet standard');
        
        try {
          signature = await provider.request({
            method: 'personal_sign',
            params: [message, address],
            network: network
          });
          console.log('✅ Signature via personal_sign');
        } catch (err) {
          try {
            signature = await provider.request({
              method: 'signMessage',
              params: { address, message, network }
            });
            console.log('✅ Signature via signMessage');
          } catch (err2) {
            signature = await provider.request({
              method: 'stacks_signMessage',
              params: { message, network }
            });
            console.log('✅ Signature via stacks_signMessage');
          }
        }
      }

      if (!signature) throw new Error('Signature non reçue');

      return { message, signature, timestamp, address };

    } catch (err) {
      console.error('❌ Erreur:', err);
      
      if (err.message?.includes('réseau')) {
        setError(err.message);
      } else if (err.message?.includes('rejected') || err.message?.includes('refusée')) {
        setError('Signature refusée par l\'utilisateur');
      } else {
        setError(err.message || 'Erreur signature');
      }
      
      throw err;
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