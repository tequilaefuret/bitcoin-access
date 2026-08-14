// src/hooks/useBitcoinBalance.js - VERSION AVEC DEBUG BALANCE
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  verifyAndRegister,
  syncUserBalance,
  publishMessage,
  getMessages,
  getUserMessages,
  getSpendingHistory,
  deductGameCost,
  getCanvasPixels,
  placeCanvasPixels,
  getUserPixelCount,
  toggleMessageUseful,
  createMessageRepost,
  markForYouNotInterested,
  setEditorialAuthorPreference as persistEditorialAuthorPreference,
  listEditorialAuthorPreferences as fetchEditorialAuthorPreferences,
  reportEditorialMessage as persistEditorialMessageReport,
  reportEditorialProfile as persistEditorialProfileReport,
  getOpinionTopics,
  setPrivateTopicStance as persistPrivateTopicStance
} from '../supabaseClient';

export const useBitcoinBalance = () => {
  const [address, setAddress] = useState('');
  const [btcBalance, setBtcBalance] = useState(0);
  const [shellsAvailable, setShellsAvailable] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const authenticatedAddressRef = useRef('');

  const applyBalance = useCallback((balance) => {
    if (!balance) return;
    if (balance.btc_balance !== undefined) setBtcBalance(Number(balance.btc_balance || 0));
    if (balance.shells_balance !== undefined) setShellsAvailable(Number(balance.shells_balance || 0));
    if (balance.new_balance !== undefined) setShellsAvailable(Number(balance.new_balance || 0));
  }, []);

  const restoreAuthenticatedUser = useCallback((user) => {
    if (!user?.bitcoin_address) return false;
    authenticatedAddressRef.current = user.bitcoin_address;
    setAddress(user.bitcoin_address);
    applyBalance(user);
    return true;
  }, [applyBalance]);

  /**
   * 🔐 Vérifier solde Bitcoin + Signature (si fournie)
   */
  const checkBitcoinBalance = useCallback(async (bitcoinAddress, signatureData) => {
    if (!bitcoinAddress) {
      setError('A Bitcoin address is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (!signatureData?.message || !signatureData?.signature) {
        throw new Error('Ownership proof is missing');
      }

      const authRequest = signatureData.authRequest || null;
      const result = await verifyAndRegister({
        address: bitcoinAddress,
        message: signatureData.message,
        signature: signatureData.signature,
        network: 'mainnet',
        personaId: signatureData.personaId || authRequest?.personaId || null,
        methodId: signatureData.methodId || authRequest?.methodId || null,
        authRequest,
        proofFormat: signatureData.proofFormat || authRequest?.proofFormat || null
      });

      if (!result.valid || !result.user) {
        throw new Error(result?.error || 'Verification failed');
      }

      authenticatedAddressRef.current = bitcoinAddress;
      setBtcBalance(Number(result.user.btc_balance || 0));
      setShellsAvailable(Number(result.user.shells_balance || 0));
      return result;

    } catch (err) {
      setError(err.message || 'Verification failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Reconcile the cached ledger in the background. Paid actions never wait for
  // this external call; a failure is retried later and does not block the UI.
  useEffect(() => {
    if (!address || authenticatedAddressRef.current !== address) return undefined;

    let cancelled = false;
    let inFlight = false;
    const synchronizeInBackground = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await syncUserBalance(address, 'mainnet');
        if (!cancelled && result?.success && result.user) {
          setBtcBalance(Number(result.user.btc_balance || 0));
          setShellsAvailable(Number(result.user.shells_balance || 0));
        }
      } catch {
        // The next scheduled reconciliation retries transient explorer failures.
      } finally {
        inFlight = false;
      }
    };

    const initialTimer = setTimeout(synchronizeInBackground, 15_000);
    const interval = setInterval(synchronizeInBackground, 5 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [address]);

  /**
   * 🎮 Démarrer une partie (coût : 0.000001 shells)
   */
  const startGame = useCallback(async () => {
    setError(''); // ← AJOUT : Réinitialiser l'erreur

    try {
      setLoading(true); // ← AJOUT : Activer le loading
      const result = await deductGameCost(address);

      if (!result.success) {
        throw new Error(result.error || 'Balance deduction failed');
      }

      if (result.user) {
        setShellsAvailable(result.user.shells_balance);
        setBtcBalance(result.user.btc_balance); // ← AJOUT : Mise à jour BTC aussi

      }

      return true;

    } catch (err) {
      // ← AJOUT : Gestion d'erreur améliorée
      if (err.message.includes('insuffisant') || err.message.includes('Insufficient')) {
        setError(
          `Insufficient shells balance\n\n` +
          `Required: ${0.000001.toFixed(8)} shells\n` +
          `Available: ${shellsAvailable.toFixed(8)} shells\n\n` +
          `Sync your Bitcoin balance to continue.`
        );
      } else {
        setError(err.message);
      }

      return false;
    } finally {
      setLoading(false); // ← AJOUT : Désactiver le loading
    }
  }, [address, shellsAvailable]); // ← AJOUT : dépendance shellsAvailable

  /**
   * 📝 Publier un message
   */
  const publishMessageCallback = useCallback(async (content, parentId = null) => {
    setError('');

    try {
      setLoading(true);

      const result = await publishMessage(address, content, parentId);

      if (!result.success) {
        throw new Error(result.error || 'Publishing failed');
      }

      // Mise à jour des états
      setShellsAvailable(result.user.shells_balance);
      setBtcBalance(result.user.btc_balance);

      setError('');
      return result;

    } catch (err) {
      if (err.message.includes('insuffisant') || err.message.includes('Insufficient')) {
        // Calculer coût du message pour l'erreur
        const charCount = content.replace(/\n/g, '').length;
        const cost = charCount * 0.00000001;

        setError(
          `Insufficient shells balance\n\n` +
          `Required: ${cost.toFixed(8)} shells\n` +
          `Available: ${shellsAvailable.toFixed(8)} shells\n\n` +
          `Sync your Bitcoin balance to continue.`
        );
      } else {
        setError('Error: ' + err.message);
      }

      return false;

    } finally {
      setLoading(false);
    }
  }, [address, shellsAvailable]);

  /**
   * 📨 Charger les messages (tous) avec pagination
   * Décompte 1 satoshi par message chargé
   */
  const loadMessages = useCallback(async (
    limit = 20,
    offset = 0,
    sortMode = 'recent',
    cursor = null
  ) => {
    try {
      setLoading(true);

      // Passer l'adresse pour vérifier Useful et décompter la lecture.
      const result = await getMessages(limit, offset, address, null, sortMode, cursor);

      // Mettre à jour le solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setShellsAvailable(result.new_balance);
      }

      return result;
    } catch (err) {

      // Gestion d'erreur améliorée
      if (err.message?.includes('insuffisant')) {
        setError(`Insufficient balance to load messages.\n\nSync your Bitcoin balance.`);
      } else {
        setError('Could not load messages: ' + err.message);
      }

      return { messages: [], hasMore: false, nextCursor: null };
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 💬 Charger les commentaires d'un message
   */
  const loadComments = useCallback(async (parentId, limit = 20, offset = 0) => {
    try {
      setLoading(true);

      const result = await getMessages(limit, offset, address, parentId);

      // Mise à jour du solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setShellsAvailable(result.new_balance);
      }

      return result.messages;

    } catch (err) {
      setError('Could not load comments: ' + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 📜 Charger l'historique des messages de l'utilisateur
   */
  const loadUserMessages = useCallback(async (limit = 20, offset = 0) => {
    if (!address) return [];

    try {
      setLoading(true);

      const messages = await getUserMessages(address, limit, offset);

      return messages;
    } catch (err) {
      setError('Could not load history: ' + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [address, setError]);

  /**
   * 🔄 Synchroniser balance (authentifié uniquement)
   */
  const manualSync = useCallback(async () => {
    if (!address) return;

    try {
      setLoading(true);
      setError('');


      const network = 'mainnet';

      const result = await syncUserBalance(address, network);

      if (result.success && result.user) {
        const newBTC = result.user.btc_balance;
        const unconfirmedBTC = result.delta || 0;

        setBtcBalance(newBTC);
        setShellsAvailable(result.user.shells_balance);

        let message = '✅ Balance synced successfully!\n\n';
        message += `BTC: ${newBTC.toFixed(8)}\n`;
        message += `Shells: ${result.user.shells_balance.toFixed(8)}`;

        if (result.delta !== 0) {
          const syncType = result.delta > 0 ? 'Added' : 'Removed';
          message += `\n\n${syncType} : ${Math.abs(result.delta).toFixed(8)} BTC`;
        }

        if (unconfirmedBTC > 0) {
          message += `\n\nPending: ${unconfirmedBTC.toFixed(8)} BTC`;
        }

        alert(message);
      }

    } catch (err) {
      setError('Could not sync balance: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // ============================================
  // CANVAS - Charger tous les pixels
  // ============================================
  const loadCanvasPixels = useCallback(async () => {
    try {
      setLoading(true);
      const pixels = await getCanvasPixels();
      return pixels;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // CANVAS - Placer des pixels (validation groupée)
  // ============================================
  const submitCanvasPixels = useCallback(async (pixels) => {
    if (!address) {
      setError('Bitcoin address is not set');
      return { success: false, error: 'Bitcoin address is not set' };
    }

    try {
      setLoading(true);
      setError('');

      const result = await placeCanvasPixels(address, pixels);

      if (!result.success) {
        throw new Error(result.error || 'Could not place pixels');
      }

      // Mettre à jour les balances locales
      setShellsAvailable(result.user.shells_balance);

      return result;

    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [address]);

  // ============================================
  // CANVAS - Compter les pixels d'un utilisateur
  // ============================================
  const loadUserPixelCount = useCallback(async () => {
    if (!address) return 0;

    try {
      const count = await getUserPixelCount(address);
      return count;
    } catch (err) {
      return 0;
    }
  }, [address]);

  const toggleUseful = useCallback(async (messageId) => {
    if (!address) throw new Error('Bitcoin address is not set');
    const result = await toggleMessageUseful(address, messageId);

    if (result.new_balance !== null && result.new_balance !== undefined) {
      setShellsAvailable(Number(result.new_balance));
    }
    if (result.shells_spent_total !== null && result.shells_spent_total !== undefined) {
    }

    return result;
  }, [address]);

  const repostMessage = useCallback(async (messageId, quoteContent = '') => {
    if (!address) throw new Error('Bitcoin address is not set');
    const result = await createMessageRepost(address, messageId, quoteContent);
    if (result.new_balance !== null && result.new_balance !== undefined) {
      setShellsAvailable(Number(result.new_balance));
    }
    if (result.shells_spent_total !== null && result.shells_spent_total !== undefined) {
    }
    return result;
  }, [address]);

  const hideForYouMessage = useCallback(async (messageId) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return markForYouNotInterested(address, messageId);
  }, [address]);

  const updateEditorialAuthorPreference = useCallback(async (targetAddress, preference) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistEditorialAuthorPreference(address, targetAddress, preference);
  }, [address]);

  const loadEditorialAuthorPreferences = useCallback(async () => {
    if (!address) return [];
    return fetchEditorialAuthorPreferences(address);
  }, [address]);

  const reportMessage = useCallback(async (messageId) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistEditorialMessageReport(address, messageId);
  }, [address]);

  const reportProfile = useCallback(async (profileAddress) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistEditorialProfileReport(address, profileAddress);
  }, [address]);

  const loadOpinionTopics = useCallback(async () => {
    if (!address) return [];
    return getOpinionTopics(address);
  }, [address]);

  const savePrivateTopicStance = useCallback(async (topicId, stance) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistPrivateTopicStance(address, topicId, stance);
  }, [address]);

  /**
   * 📜 Charger l'historique des dépenses
   */
  const loadSpendingHistory = useCallback(async (limit = 20) => {
    if (!address) return [];

    try {
      return await getSpendingHistory(address, limit);
    } catch (err) {
      setError('Could not load history: ' + err.message);
      return [];
    }
  }, [address]);

  return {
    address,
    btcBalance,
    shellsAvailable,
    loading,
    error,
    setAddress,
    setError,
    restoreAuthenticatedUser,
    checkBitcoinBalance,
    startGame,
    publishMessage: publishMessageCallback,
    loadMessages,
    loadUserMessages,
    manualSync,
    loadSpendingHistory,
    loadCanvasPixels,
    submitCanvasPixels,
    loadUserPixelCount,
    loadComments,
    toggleUseful,
    repostMessage,
    hideForYouMessage,
    updateEditorialAuthorPreference,
    loadEditorialAuthorPreferences,
    reportMessage,
    reportProfile,
    loadOpinionTopics,
    savePrivateTopicStance
  };
};
