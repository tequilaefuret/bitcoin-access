// Application facade for authenticated balance and paid product operations.
import { useState, useCallback, useEffect, useRef } from 'react';
import { usePendingActivity } from './usePendingActivity';
import { friendlyShellError } from '../lib/shells';
import {
  verifyAndRegister,
  syncUserBalance,
  publishMessage,
  getMessages,
  getSpendingHistory,
  deductGameCost,
  getCanvasPixels,
  placeCanvasPixels,
  getUserPixelCount,
  toggleMessageUseful,
  createMessageRepost,
  markForYouNotInterested,
  setEditorialAuthorPreference as persistEditorialAuthorPreference,
  setEditorialTopicPreference as persistEditorialTopicPreference,
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
  const [error, setError] = useState('');
  const authenticatedAddressRef = useRef('');
  const { loading, beginActivity, endActivity } = usePendingActivity();

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

    beginActivity();
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
      endActivity();
    }
  }, [beginActivity, endActivity]);

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

  /** Démarrer une partie (coût : 100 shells). */
  const startGame = useCallback(async () => {
    setError('');

    try {
      beginActivity();
      const result = await deductGameCost(address);

      if (!result.success) {
        throw new Error(result.error || 'Balance deduction failed');
      }

      if (result.user) {
        setShellsAvailable(result.user.shells_balance);
        setBtcBalance(result.user.btc_balance);

      }

      return true;

    } catch (err) {
      setError(friendlyShellError(err));

      return false;
    } finally {
      endActivity();
    }
  }, [address, beginActivity, endActivity]);

  /**
   * 📝 Publier un message
   */
  const publishMessageCallback = useCallback(async (content, parentId = null) => {
    setError('');

    try {
      beginActivity();

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
      setError(friendlyShellError(err, 'Publishing failed'));

      return false;

    } finally {
      endActivity();
    }
  }, [address, beginActivity, endActivity]);

  /**
   * 📨 Charger les messages (tous) avec pagination
   * Décompte 1 shell par publication d'un autre auteur chargée
   */
  const loadMessages = useCallback(async (
    limit = 20,
    offset = 0,
    sortMode = 'recent',
    cursor = null
  ) => {
    try {
      beginActivity();

      // Passer l'adresse pour vérifier Useful et décompter la lecture.
      const result = await getMessages(limit, offset, address, null, sortMode, cursor);

      // Mettre à jour le solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setShellsAvailable(result.new_balance);
      }

      return result;
    } catch (err) {

      // Gestion d'erreur améliorée
      setError(friendlyShellError(err, 'Could not load messages'));

      return { messages: [], hasMore: false, nextCursor: null };
    } finally {
      endActivity();
    }
  }, [address, beginActivity, endActivity]);

  /**
   * 💬 Charger les commentaires d'un message
   */
  const loadComments = useCallback(async (parentId, limit = 20, offset = 0) => {
    try {
      beginActivity();

      const result = await getMessages(limit, offset, address, parentId);

      // Mise à jour du solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setShellsAvailable(result.new_balance);
      }

      return result.messages;

    } catch (err) {
      setError(friendlyShellError(err, 'Could not load comments'));
      return [];
    } finally {
      endActivity();
    }
  }, [address, beginActivity, endActivity]);

  // ============================================
  // CANVAS - Charger tous les pixels
  // ============================================
  const loadCanvasPixels = useCallback(async () => {
    try {
      beginActivity();
      const pixels = await getCanvasPixels();
      return pixels;
    } catch (err) {
      setError(friendlyShellError(err));
      return [];
    } finally {
      endActivity();
    }
  }, [beginActivity, endActivity]);

  // ============================================
  // CANVAS - Placer des pixels (validation groupée)
  // ============================================
  const submitCanvasPixels = useCallback(async (pixels) => {
    if (!address) {
      setError('Bitcoin address is not set');
      return { success: false, error: 'Bitcoin address is not set' };
    }

    try {
      beginActivity();
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
      endActivity();
    }
  }, [address, beginActivity, endActivity]);

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

    return result;
  }, [address]);

  const repostMessage = useCallback(async (messageId, quoteContent = '') => {
    if (!address) throw new Error('Bitcoin address is not set');
    const result = await createMessageRepost(address, messageId, quoteContent);
    if (result.new_balance !== null && result.new_balance !== undefined) {
      setShellsAvailable(Number(result.new_balance));
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

  const updateEditorialTopicPreference = useCallback(async (messageId, preference = 'reduce') => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistEditorialTopicPreference(address, messageId, preference);
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
    const result = await getOpinionTopics(address);
    if (result?.new_balance !== undefined) setShellsAvailable(Number(result.new_balance) || 0);
    return result?.topics || [];
  }, [address]);

  const savePrivateTopicStance = useCallback(async (topicId, stance) => {
    if (!address) throw new Error('Bitcoin address is not set');
    return persistPrivateTopicStance(address, topicId, stance);
  }, [address]);

  /**
   * 📜 Charger l'historique des dépenses
   */
  const loadSpendingHistory = useCallback(async (limit = 20, offset = 0) => {
    if (!address) return { history: [], hasMore: false, nextOffset: 0 };

    try {
      return await getSpendingHistory(address, limit, offset);
    } catch (err) {
      setError('Could not load history: ' + err.message);
      return { history: [], hasMore: false, nextOffset: offset };
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
    updateBalance: applyBalance,
    restoreAuthenticatedUser,
    checkBitcoinBalance,
    startGame,
    publishMessage: publishMessageCallback,
    loadMessages,
    loadSpendingHistory,
    loadCanvasPixels,
    submitCanvasPixels,
    loadUserPixelCount,
    loadComments,
    toggleUseful,
    repostMessage,
    hideForYouMessage,
    updateEditorialAuthorPreference,
    updateEditorialTopicPreference,
    loadEditorialAuthorPreferences,
    reportMessage,
    reportProfile,
    loadOpinionTopics,
    savePrivateTopicStance
  };
};
