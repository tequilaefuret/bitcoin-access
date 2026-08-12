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
import {
  getInjectedBitcoinProviders,
  requestWalletStandardRegistration,
  selectBitcoinAccount,
  subscribeToBitcoinProviderChanges,
} from '../lib/injectedBitcoinProviders';

// ✅ SINGLETON GLOBAL : Une seule instance du modal pour toute l'application
let globalModalInstance = null;
let globalModalInitializing = false;
const MAX_SIGNATURE_WAIT_MS = 300_000;
const CHALLENGE_EXPIRY_MARGIN_MS = 10_000;

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  promise.then(
    (value) => {
      clearTimeout(timeout);
      resolve(value);
    },
    (error) => {
      clearTimeout(timeout);
      reject(error);
    },
  );
});

const signatureWaitTime = (authRequest) => {
  const expiresAt = Date.parse(authRequest?.expiresAt || authRequest?.expires_at || '');
  if (!Number.isFinite(expiresAt)) return MAX_SIGNATURE_WAIT_MS;
  return Math.min(MAX_SIGNATURE_WAIT_MS, expiresAt - Date.now() - CHALLENGE_EXPIRY_MARGIN_MS);
};

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
  const [injectedWallets, setInjectedWallets] = useState([]);

  const hasCheckedConnection = useRef(false);
  const injectedProviderRef = useRef(null);

  useEffect(() => {
    const refresh = () => {
      const nextWallets = getInjectedBitcoinProviders().map(({ id, name }) => ({ id, name }));
      setInjectedWallets((currentWallets) => {
        const currentIds = currentWallets.map(({ id }) => id).join('|');
        const nextIds = nextWallets.map(({ id }) => id).join('|');
        return currentIds === nextIds ? currentWallets : nextWallets;
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        requestWalletStandardRegistration();
        refresh();
      }
    };
    const requestAndRefresh = () => {
      requestWalletStandardRegistration();
      refresh();
    };

    refresh();
    const timeouts = [500, 1500, 3000].map((delay) => setTimeout(requestAndRefresh, delay));
    const unsubscribeWalletStandard = subscribeToBitcoinProviderChanges(refresh);
    window.addEventListener('focus', requestAndRefresh);
    window.addEventListener('pageshow', requestAndRefresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      timeouts.forEach(clearTimeout);
      unsubscribeWalletStandard();
      window.removeEventListener('focus', requestAndRefresh);
      window.removeEventListener('pageshow', requestAndRefresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

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
          name: 'Danaus',
          description: 'Prove Bitcoin ownership to access Danaus',
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
                  injectedProviderRef.current = null;
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
        throw new Error('Wallet selector is not initialized. Reload the page.');
      }

      hasCheckedConnection.current = false;
      injectedProviderRef.current = null;
      await modal.open();
      setIsConnecting(false);
      return null;

    } catch (err) {
      setError(err.message || 'Connection failed');
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
      if (!modal && !injectedProviderRef.current) throw new Error('Wallet is not connected');

      const authRequest = options.authRequest;
      if (!authRequest?.requestId || !authRequest?.challenge) {
        throw new Error('The server challenge is missing. Start the connection again.');
      }
      const signingTimeout = signatureWaitTime(authRequest);
      if (signingTimeout <= 0) {
        throw new Error('The authentication request expired. Start the connection again.');
      }
      const message = typeof options.message === 'string' ? options.message : authRequest.challenge;
      const addressNetwork = address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3') ? 'mainnet' : 'unknown';
      if (addressNetwork !== 'mainnet') {
        throw new Error('Invalid Bitcoin address. Only mainnet addresses are accepted.');
      }

      const provider = injectedProviderRef.current || await modal.getWalletProvider();
      if (!provider) throw new Error('Provider non disponible');

      if (!injectedProviderRef.current && typeof modal.isOpen === 'function' && modal.isOpen()) {
        await modal.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 250));

      const signature = await withTimeout(
        signMessageWithProvider(provider, address, message),
        signingTimeout,
        'No signature response was received. Reopen the wallet and try again.',
      );

      if (!signature) throw new Error('Signature was not received');

      return {
        message,
        signature,
        address,
        authRequest
      };
    } catch (err) {
      if (err?.code === 4100) {
        setError('The wallet refused to sign for this address. Disconnect it, reconnect it, and try again.');
        throw err;
      }

      if (err.message?.includes('network')) {
        setError(err.message);
      } else if (err.message?.includes('rejected') || err.message?.includes('refused')) {
        setError('Signature was rejected by the user');
      } else {
        setError(err.message || 'Signature failed');
      }

      throw err;
    }
  }, [modal]);

  const connectInjectedWallet = useCallback(async (walletId) => {
    setError('');
    setIsConnecting(true);

    try {
      const wallet = getInjectedBitcoinProviders().find((candidate) => candidate.id === walletId);
      if (!wallet) throw new Error('Installed Bitcoin wallet not found.');

      const account = selectBitcoinAccount(await wallet.provider.requestAccounts());
      const finalAddress = normalizeBitcoinAddress(account?.address);
      if (!finalAddress) {
        const accountError = new Error('The wallet did not provide a Bitcoin payment address.');
        accountError.code = 'BITCOIN_ACCOUNT_UNAVAILABLE';
        throw accountError;
      }

      injectedProviderRef.current = wallet.provider;
      setConnectedAddress(finalAddress);
      setConnectedWallet(wallet.name);
      setWalletProfile({
        brand: detectWalletBrand(wallet.provider),
        name: wallet.name,
        capabilities: detectWalletCapabilities(wallet.provider),
      });
      return finalAddress;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const signPsbt = useCallback(async (address, psbtBase64) => {
    setError('');
    if (!modal && !injectedProviderRef.current) throw new Error('Wallet not connected');
    if (!address || !psbtBase64) throw new Error('Address and PSBT are required');

    try {
      const provider = injectedProviderRef.current || await modal.getWalletProvider();
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
    injectedProviderRef.current = null;
    setConnectedAddress(null);
    setConnectedWallet(null);
    setWalletProfile(null);
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
    connectInjectedWallet,
    injectedWallets,
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
