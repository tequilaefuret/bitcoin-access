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
        // console.log('♻️ Réutilisation instance modal existante');
        setModal(globalModalInstance);
        return;
      }

      // ✅ Si en cours d'initialisation, attendre
      if (globalModalInitializing) {
        console.log('⏳ Initialisation déjà en cours, attente...');
        const checkInterval = setInterval(() => {
          if (globalModalInstance) {
            // console.log('✅ Instance prête, liaison au hook');
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

        const isDev = process.env.REACT_APP_ENVIRONMENT === 'development';
        const networks = isDev ? [bitcoinTestnet] : [bitcoin];

        const metadata = {
          name: 'Bitcoin Exclusive Access',
          description: 'Prouvez votre détention de Bitcoin pour accéder au jeu',
          url: window.location.origin,
          icons: ['https://avatars.githubusercontent.com/u/37784886']
        };

        const bitcoinAdapter = new BitcoinAdapter({ projectId });

        const appKitModal = createAppKit({
          adapters: [bitcoinAdapter],
          networks,
          projectId,
          metadata,
          features: {
            analytics: false,
            email: false,
            socials: false
          },
          defaultNetwork: isDev ? bitcoinTestnet : bitcoin,
          enableCoinbase: false,
          enableInjected: true,
          enableWalletConnect: true
        });

        // Écouter les changements d'état
        appKitModal.subscribeState((state) => {
          // console.log('📊 État modal:', state.open ? 'Ouvert' : 'Fermé');
          
          if (!state.open && state.selectedNetworkId && !hasCheckedConnection.current) {
            hasCheckedConnection.current = true;
            
            // console.log('🔍 Connexion détectée, récupération de l\'adresse...');
            
            setTimeout(() => {
              try {
                const address = appKitModal.getAddress();
                const caipAddress = appKitModal.getCaipAddress();

                // console.log('  - getAddress():', address);
                // console.log('  - getCaipAddress():', caipAddress);

                if (address || caipAddress) {
                  const finalAddress = address || (caipAddress ? caipAddress.split(':').pop() : null);
                  console.log('✅ Adresse connectée:', finalAddress);
                  
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

      // console.log('🔓 Ouverture du modal de connexion...');
      
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

        // DÉTECTION DU RÉSEAU BASÉ SUR L'ADRESSE
        const network = address.startsWith('tb1') || 
                        address.startsWith('2') || 
                        address.startsWith('m') || 
                        address.startsWith('n')
          ? 'testnet'
          : 'mainnet';

        console.log('🌐 Réseau détecté pour signature:', network);
        console.log('📝 Message à signer:', message);
        console.log('📍 Adresse:', address);

        const provider = await modal.getWalletProvider();
        
        if (!provider) {
          throw new Error('Provider non disponible');
        }

        let signature;
        
        try {
          // TENTATIVE 1 : personal_sign avec network
          signature = await provider.request({
            method: 'personal_sign',
            params: [message, address],
            network: network  // ⚠️ FIX LEATHER
          });
          
          console.log('✅ Signature via personal_sign');
          
        } catch (err) {
          console.log('⚠️ personal_sign échoué, tentative signMessage...');
          
          try {
            // TENTATIVE 2 : signMessage avec network
            signature = await provider.request({
              method: 'signMessage',
              params: {
                address: address,
                message: message,
                network: network  // ⚠️ FIX LEATHER
              }
            });
            
            console.log('✅ Signature via signMessage');
            
          } catch (err2) {
            console.log('⚠️ signMessage échoué, tentative stacks_signMessage (Leather)...');
            
            // TENTATIVE 3 : Méthode spécifique Leather
            signature = await provider.request({
              method: 'stacks_signMessage',
              params: {
                message: message,
                network: network  // ⚠️ FIX LEATHER
              }
            });
            
            console.log('✅ Signature via stacks_signMessage');
          }
        }

        if (!signature) {
          throw new Error('Signature non reçue du wallet');
        }

        console.log('✅ Signature reçue:', typeof signature === 'object' ? JSON.stringify(signature) : signature.substring(0, 20) + '...');

        return {
          message: message,
          signature: signature,
          timestamp: timestamp,
          address: address
        };

      } catch (err) {
        console.error('❌ Erreur signature:', err);
        
        if (err.message?.includes('not supported') || err.message?.includes('MethodNotSupported')) {
          setError('Ce wallet ne supporte pas la signature de messages');
          throw new Error('Wallet non compatible avec la signature de messages');
        } else if (err.message?.includes('rejected') || err.message?.includes('User rejected')) {
          setError('Signature refusée par l\'utilisateur');
          throw new Error('Signature refusée par l\'utilisateur');
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
      
      // console.log('🔄 Refresh adresse:', { address, caipAddress, isConnected });
      
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