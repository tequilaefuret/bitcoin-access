import { useState, useCallback, useEffect, useRef } from 'react';
import { createAppKit } from '@reown/appkit';
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin';
import { bitcoin } from '@reown/appkit/networks';
import {
  detectWalletBrand,
  detectWalletCapabilities,
  signMessageWithProvider,
  signPsbtWithProvider,
} from '../lib/bitcoinWalletProvider';
import { normalizeBitcoinAddress } from '../lib/bitcoinAddress';

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
  const [walletProfile, setWalletProfile] = useState(null);
  
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
          setError('Configuration manquante (Project ID)');
          globalModalInitializing = false;
          return;
        }

        const networks = [bitcoin];

        const metadata = {
          name: 'Bitcoin Exclusive Access',
          description: 'Prouvez votre détention de Bitcoin pour accéder au jeu',
          url: window.location.origin,
          icons: ['https://avatars.githubusercontent.com/u/37784886']
        };

        const bitcoinAdapter = new BitcoinAdapter({ 
          projectId,
          chains: ['bip122:000000000019d6689c085ae165831e93'] // Bitcoin mainnet
        });

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
          defaultNetwork: bitcoin,
          enableCoinbase: false,
          enableInjected: true,
          enableWalletConnect: true
        });

        // Écouter les changements d'état
        appKitModal.subscribeState((state) => {
          if (!state.open && state.selectedNetworkId && !hasCheckedConnection.current) {
            hasCheckedConnection.current = true;
            
            setTimeout(async () => {
              try {
                const address = appKitModal.getAddress();
                const caipAddress = appKitModal.getCaipAddress();

                let provider = null;
                
                try {
                  provider = await appKitModal.getWalletProvider();
                  
                } catch {
                }

                // AppKit a déjà obtenu et autorisé cette adresse pendant la connexion.
                // Ne pas rappeler getAddresses ici: certains wallets refusent deux requêtes concurrentes.
                const finalAddress = normalizeBitcoinAddress(address || caipAddress);
                if (finalAddress) {
                  const brand = detectWalletBrand(provider);
                  const capabilities = detectWalletCapabilities(provider);

                  // 🆕 VÉRIFICATION RÉSEAU DE L'ADRESSE
                  // ✅ MODIFICATION : Mettre à jour l'état mais laisser App.js gérer la navigation
                  setConnectedAddress(finalAddress);
                  setConnectedWallet('bitcoin');
                  setWalletProfile({
                    brand,
                    name: provider?.name || brand,
                    capabilities
                  });
                  
                }
              } catch {
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
        
      } catch {
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
      setError(err.message || 'Échec de la connexion');
      setIsConnecting(false);
      return null;
    }
  }, [modal]);

  /**
   * Demande une signature de message
   */
  const signMessage = useCallback(async (address, options = {}) => {
    setError('');

    try {
      if (!modal) throw new Error('Wallet non connecté');

      const authRequest = options.authRequest;
      if (!authRequest?.requestId || !authRequest?.challenge) {
        throw new Error('Challenge serveur manquant. Relancez la connexion.');
      }
      const message = typeof options.message === 'string' ? options.message : authRequest.challenge;
      // Laisser la modale se refermer avant d'ouvrir la demande de signature.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const addressNetwork = address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3') ? 'mainnet' : 'unknown';
      if (addressNetwork !== 'mainnet') {
        throw new Error('Mauvaise adresse Bitcoin. Seules les adresses mainnet sont acceptées.');
      }

      const provider = await modal.getWalletProvider();
      if (!provider) throw new Error('Provider non disponible');

      const signature = await signMessageWithProvider(provider, address, message);

      if (!signature) throw new Error('Signature non reçue');

      return {
        message,
        signature,
        address,
        authRequest
      };
    } catch (err) {
      if (err?.code === 4100) {
        setError('Le wallet a refusé l’autorisation de signature pour cette adresse. Déconnecte puis reconnecte le wallet et réessaie.');
        throw err;
      }

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

  const signPsbt = useCallback(async (address, psbtBase64) => {
    setError('');
    if (!modal) throw new Error('Wallet not connected');
    if (!address || !psbtBase64) throw new Error('Address and PSBT are required');

    try {
      const provider = await modal.getWalletProvider();
      if (!provider) throw new Error('Wallet provider unavailable');
      return await signPsbtWithProvider(provider, address, psbtBase64);
    } catch (signingError) {
      const message = signingError?.message || 'Unable to sign the PSBT';
      setError(message);
      throw signingError;
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
        setWalletProfile(null);
        hasCheckedConnection.current = false;
      } catch {
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
        setWalletProfile({
          brand: 'bitcoin',
          name: 'bitcoin',
          capabilities: {
            supportsMessageSigning: true,
            supportsPsbt: true,
            supportsWalletConnect: true
          }
        });
        return finalAddress;
      }
    } catch {
    }
    
    return null;
  }, [modal]);

  return {
    connectWallet,
    signMessage,
    signPsbt,
    disconnectWallet,
    refreshConnectedAddress,
    isConnecting,
    error,
    connectedAddress,
    connectedWallet,
    walletProfile,
    modal
  };
}
