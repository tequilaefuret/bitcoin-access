// src/hooks/useBitcoinBalance.js - VERSION AVEC DEBUG BALANCE
import { useState, useCallback } from 'react';
import { 
  verifyAndRegister,
  syncUserBalance,
  publishMessage,
  getMessages,
  getUserMessages,
  getUserStats,
  deductGameCost,
  getCanvasPixels,
  placeCanvasPixels,
  getUserPixelCount
} from '../supabaseClient';

export const useBitcoinBalance = () => {
  const [address, setAddress] = useState('');
  const [btcBalance, setBtcBalance] = useState(0);
  const [btcUnconfirmed, setBtcUnconfirmed] = useState(0);
  const [wbtcAvailable, setWbtcAvailable] = useState(0);
  const [wbtcSpentTotal, setWbtcSpentTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');

  /**
   * 🔍 Récupérer le solde BTC confirmé via Mempool.space
   */
  const fetchConfirmedBalance = async (bitcoinAddress) => {
    try {
      const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK;
      let apiUrl;

      if (networkConfig === 'testnet4') {
        apiUrl = `https://mempool.space/testnet4/api/address/${bitcoinAddress}`;
      } else if (networkConfig === 'testnet' || networkConfig === 'testnet3') {
        apiUrl = `https://mempool.space/testnet/api/address/${bitcoinAddress}`;
      } else {
        apiUrl = `https://mempool.space/api/address/${bitcoinAddress}`;
      }

      console.log('🌐 URL API:', apiUrl);

      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        if (response.status === 404) {
          return { confirmed: 0, unconfirmed: 0, total: 0 };
        }
        throw new Error('API_ERROR');
      }
      
      const data = await response.json();
      
      // ✅ DEBUG : Afficher les valeurs brutes
      console.log('📊 Réponse mempool.space complète:', data);
      console.log('💰 funded_txo_sum:', data.chain_stats.funded_txo_sum);
      console.log('💸 spent_txo_sum:', data.chain_stats.spent_txo_sum);
      console.log('🧮 Différence en satoshis:', data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum);
      
      const confirmedBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
      const unconfirmedBalance = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum) / 100000000;
      
      console.log('✅ Balance confirmée calculée:', confirmedBalance, 'BTC');
      console.log('⏳ Balance non confirmée:', unconfirmedBalance, 'BTC');
      
      return {
        confirmed: confirmedBalance,
        unconfirmed: unconfirmedBalance,
        total: confirmedBalance + unconfirmedBalance
      };
    } catch (error) {
      console.error('❌ Erreur fetchConfirmedBalance:', error);
      throw error;
    }
  };

  /**
   * 🔐 Vérifier solde Bitcoin + Signature (si fournie)
   */
  const checkBitcoinBalance = useCallback(async (bitcoinAddress, signatureData = null, isTestMode = false) => {
    console.log('🔍 checkBitcoinBalance appelé avec:', { 
      bitcoinAddress: bitcoinAddress?.slice(0, 8) + '...' + bitcoinAddress?.slice(-6), 
      hasSignature: !!signatureData,
      isTestMode
    });

    if (!bitcoinAddress) {
      setError('Adresse Bitcoin requise');
      return;
    }

    setLoading(true);
    setError('');
    setVerificationStatus('Vérification...');

    try {
      // 🆕 MODE TEST : Récupération balance uniquement (pas de BDD)
      if (isTestMode) {
        console.log('🧪 Mode test : récupération balance BTC uniquement');
        
        const balances = await fetchConfirmedBalance(bitcoinAddress);
        
        // Stockage local du solde initial en mode test
        const testBalance = {
          btc: balances.confirmed,
          wbtc: balances.confirmed, // 1:1
          spent: 0
        };
        sessionStorage.setItem('test_balance', JSON.stringify(testBalance));
        
        setBtcBalance(balances.confirmed);
        setBtcUnconfirmed(balances.unconfirmed);
        setWbtcAvailable(balances.confirmed);
        setWbtcSpentTotal(0);
        setVerificationStatus('');
        setLoading(false);
        return;
      }

      // MODE AUTHENTIFIÉ : Vérification complète avec BDD
      if (signatureData) {
        console.log('✅ Signature fournie - vérification complète');
        
        const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
        const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';
        
        const result = await verifyAndRegister({
          address: bitcoinAddress,
          message: signatureData.message,
          signature: signatureData.signature,
          network
        });

        if (result.valid && result.user) {
          console.log('✅ Résultat verify-and-register:', result.user);
          setBtcBalance(result.user.btc_balance);
          setWbtcAvailable(result.user.wbtc_balance);
          setWbtcSpentTotal(result.user.wbtc_spent_total);
          setBtcUnconfirmed(0);
        }
      } else {
        console.log('📊 Pas de signature - chargement depuis BDD existante');
        
        const balances = await fetchConfirmedBalance(bitcoinAddress);
        setBtcBalance(balances.confirmed);
        setBtcUnconfirmed(balances.unconfirmed);
      }

      setVerificationStatus('');
      
    } catch (err) {
      console.error('❌ Erreur vérification:', err);
      setError(err.message || 'Erreur lors de la vérification');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 🎮 Démarrer une partie (coût : 0.000001 wBTC)
   */
  const startGame = useCallback(async (isTestMode = false) => {
    console.log('🎮 Démarrage partie - Mode test:', isTestMode);
    setError(''); // ← AJOUT : Réinitialiser l'erreur
    
    try {
      setLoading(true); // ← AJOUT : Activer le loading
      const gameCost = 0.000001;
      
      // 🆕 MODE TEST : Déduction locale sans BDD
      if (isTestMode) {
        const testBalanceStr = sessionStorage.getItem('test_balance');
        if (!testBalanceStr) {
          throw new Error('Balance test non trouvée');
        }
        
        const testBalance = JSON.parse(testBalanceStr);
        
        if (testBalance.wbtc < gameCost) {
          throw new Error(
            `Solde insuffisant. Requis: ${gameCost.toFixed(8)}, Disponible: ${testBalance.wbtc.toFixed(8)}`
          );
        }
        
        // Déduction locale
        testBalance.wbtc -= gameCost;
        testBalance.spent += gameCost;
        
        sessionStorage.setItem('test_balance', JSON.stringify(testBalance));
        
        setWbtcAvailable(testBalance.wbtc);
        setWbtcSpentTotal(testBalance.spent);
        
        console.log('✅ Partie démarrée (mode test local)');
        return true;
      }
      
      // MODE AUTHENTIFIÉ : Déduction en BDD
      console.log('💳 Déduction en BDD pour partie authentifiée');
      const result = await deductGameCost(address, gameCost);
      
      if (!result.success) {
        throw new Error(result.error || 'Déduction échouée');
      }
      
      if (result.user) {
        setWbtcAvailable(result.user.wbtc_balance);
        setWbtcSpentTotal(result.user.wbtc_spent_total);
        setBtcBalance(result.user.btc_balance); // ← AJOUT : Mise à jour BTC aussi
        
        console.log('✅ Partie démarrée. Nouveau solde:', result.user.wbtc_balance);
      }
      
      return true;
      
    } catch (err) {
      console.error('❌ Erreur démarrage partie:', err);
      
      // ← AJOUT : Gestion d'erreur améliorée
      if (err.message.includes('insuffisant') || err.message.includes('Insufficient')) {
        setError(
          `Solde wBTC insuffisant\n\n` +
          `Requis : ${0.000001.toFixed(8)} wBTC\n` +
          `Actuel : ${wbtcAvailable.toFixed(8)} wBTC\n\n` +
          `Rechargez votre compte Bitcoin pour continuer.`
        );
      } else {
        setError(err.message);
      }
      
      return false;
    } finally {
      setLoading(false); // ← AJOUT : Désactiver le loading
    }
  }, [address, wbtcAvailable]); // ← AJOUT : dépendance wbtcAvailable

  /**
   * 💾 Sauvegarder le score d'une partie
   */
  const saveGameScore = useCallback(async (score) => {
    if (!address) {
      console.log('⚠️ Pas d\'adresse, impossible de sauvegarder le score');
      return false;
    }
    
    try {
      console.log('💾 Sauvegarde score:', score, 'pour', address);
      
      // TODO: Implémenter la sauvegarde en BDD si nécessaire
      // const result = await saveScore(address, score);
      
      return true;
    } catch (err) {
      console.error('❌ Erreur sauvegarde score:', err);
      return false;
    }
  }, [address]);

  /**
   * 📝 Publier un message
   */
  const publishMessageCallback = useCallback(async (content, isTestMode = false, parentId = null) => {
    setError('');
    
    try {
      setLoading(true);
      
      // Calculer coût (espaces comptent, pas les retours à la ligne)
      const charCount = content.replace(/\n/g, '').length;
      const cost = charCount * 0.00000001;
      
      console.log('📝 Publication message - Caractères:', charCount, '| Coût:', cost, 'wBTC');
      
      // 🆕 MODE TEST : Déduction locale sans BDD
      if (isTestMode) {
        const testBalanceStr = sessionStorage.getItem('test_balance');
        if (!testBalanceStr) {
          throw new Error('Balance test non trouvée');
        }
        
        const testBalance = JSON.parse(testBalanceStr);
        
        if (testBalance.wbtc < cost) {
          throw new Error(`Solde insuffisant. Requis: ${cost.toFixed(8)}, Disponible: ${testBalance.wbtc.toFixed(8)}`);
        }
        
        // Déduction locale
        testBalance.wbtc -= cost;
        testBalance.spent += cost;
        
        sessionStorage.setItem('test_balance', JSON.stringify(testBalance));
        
        setWbtcAvailable(testBalance.wbtc);
        setWbtcSpentTotal(testBalance.spent);
        
        console.log('✅ Message publié (mode test local)');
        setError('');
        return true;
      }
      
      // MODE AUTHENTIFIÉ : Publication en BDD
      const result = await publishMessage(address, content, parentId);
      
      if (!result.success) {
        throw new Error(result.error || 'Publication échouée');
      }
      
      // Mise à jour des états
      setWbtcAvailable(result.user.wbtc_balance);
      setWbtcSpentTotal(result.user.wbtc_spent_total);
      setBtcBalance(result.user.btc_balance);
      
      console.log('✅ Message publié. Nouveau solde:', result.user.wbtc_balance);
      setError('');
      return result;
      
    } catch (err) {
      console.error('❌ Erreur publication message:', err);
      
      if (err.message.includes('insuffisant') || err.message.includes('Insufficient')) {
        // Calculer coût du message pour l'erreur
        const charCount = content.replace(/\n/g, '').length;
        const cost = charCount * 0.00000001;
        
        setError(
          `Solde wBTC insuffisant\n\n` +
          `Requis : ${cost.toFixed(8)} wBTC\n` +
          `Actuel : ${wbtcAvailable.toFixed(8)} wBTC\n\n` +
          `Rechargez votre compte Bitcoin pour continuer.`
        );
      } else {
        setError('Erreur : ' + err.message);
      }
      
      return false;
      
    } finally {
      setLoading(false);
    }
  }, [address, wbtcAvailable]);

  /**
   * 📨 Charger les messages (tous) avec pagination
   * Décompte 1 satoshi par message chargé
   */
  const loadMessages = useCallback(async (limit = 20, offset = 0) => {
    try {
      setLoading(true);
      console.log('📨 Chargement messages - Limit:', limit, '| Offset:', offset);
      
      // Passer l'adresse pour vérifier likes/dislikes et décompter
      const result = await getMessages(limit, offset, address);
      
      // Mettre à jour le solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setWbtcAvailable(result.new_balance);
        console.log(`💰 Nouveau solde après lecture: ${result.new_balance.toFixed(8)} wBTC`);
      }
      
      console.log(`✅ ${result.messages.length} messages récupérés | Coût: ${result.cost?.toFixed(8) || 0} wBTC`);
      
      return result.messages;
    } catch (err) {
      console.error('❌ Erreur chargement messages:', err);
      
      // Gestion d'erreur améliorée
      if (err.message?.includes('insuffisant')) {
        setError(`Solde insuffisant pour charger les messages.\n\nRechargez votre compte Bitcoin.`);
      } else {
        setError('Erreur chargement messages : ' + err.message);
      }
      
      return [];
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
      console.log('💬 Chargement commentaires du message:', parentId.slice(0, 8));
      
      const result = await getMessages(limit, offset, address, parentId);
      
      // Mise à jour du solde si retourné
      if (result.new_balance !== null && result.new_balance !== undefined) {
        setWbtcAvailable(result.new_balance);
        console.log(`💰 Nouveau solde après lecture commentaires: ${result.new_balance.toFixed(8)} wBTC`);
      }
      
      console.log(`✅ ${result.messages.length} commentaires récupérés`);
      return result.messages;
      
    } catch (err) {
      console.error('❌ Erreur chargement commentaires:', err);
      setError('Erreur chargement commentaires : ' + err.message);
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
      console.log('📜 Chargement historique utilisateur - Limit:', limit, '| Offset:', offset);
      
      const messages = await getUserMessages(address, limit, offset);
      console.log(`✅ ${messages.length} messages utilisateur récupérés`);
      
      return messages;
    } catch (err) {
      console.error('❌ Erreur chargement historique:', err);
      setError('Erreur chargement historique : ' + err.message);
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
      
      console.log('🔄 Synchronisation manuelle pour:', address.slice(0, 8) + '...' + address.slice(-6));
      
      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';
      
      const result = await syncUserBalance(address, network);
      
      if (result.success && result.user) {
        const newBTC = result.user.btc_balance;
        const unconfirmedBTC = result.delta || 0;
        
        setBtcBalance(newBTC);
        setWbtcAvailable(result.user.wbtc_balance);
        setWbtcSpentTotal(result.user.wbtc_spent_total);
        setBtcUnconfirmed(unconfirmedBTC);
        
        let message = '✅ Synchronisation réussie!\n\n';
        message += `BTC: ${newBTC.toFixed(8)}\n`;
        message += `wBTC: ${result.user.wbtc_balance.toFixed(8)}`;
        
        if (result.delta !== 0) {
          const syncType = result.delta > 0 ? 'Rechargement' : 'Retrait';
          message += `\n\n${syncType} : ${Math.abs(result.delta).toFixed(8)} BTC`;
        }
        
        if (unconfirmedBTC > 0) {
          message += `\n\nEn attente : ${unconfirmedBTC.toFixed(8)} BTC`;
        }
        
        alert(message);
      }
      
    } catch (err) {
      console.error('❌ Erreur synchronisation:', err);
      setError('Erreur synchronisation : ' + err.message);
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
      console.error('❌ Erreur chargement canvas:', err);
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
      setError('Adresse non définie');
      return { success: false, error: 'Adresse non définie' };
    }

    try {
      setLoading(true);
      setError('');

      const result = await placeCanvasPixels(address, pixels);

      if (!result.success) {
        throw new Error(result.error || 'Placement pixels échoué');
      }

      // Mettre à jour les balances locales
      setWbtcAvailable(result.user.wbtc_balance);
      setWbtcSpentTotal(result.user.wbtc_spent_total);

      return result;

    } catch (err) {
      console.error('❌ Erreur submitCanvasPixels:', err);
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
      console.error('❌ Erreur comptage pixels utilisateur:', err);
      return 0;
    }
  }, [address]);

  /**
  * Action sociale (like, dislike, remove_like, remove_dislike)
  * Gère automatiquement la mise à jour du solde
  */
  const socialAction = useCallback(async (action, messageId) => {
    if (!address) {
      throw new Error('Adresse non définie');
    }

    try {
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
      
      const response = await fetch(`${supabaseUrl}/functions/v1/social-like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey
        },
        body: JSON.stringify({ messageId, bitcoinAddress: address, action })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur action sociale');
      }

      if (!data.success) {
        throw new Error(data.error || 'Échec action sociale');
      }

      // ✅ Mise à jour automatique du solde si retourné
      if (data.new_balance !== null && data.new_balance !== undefined) {
        console.log('💰 Nouveau solde après action sociale:', data.new_balance.toFixed(8), 'wBTC');
        setWbtcAvailable(data.new_balance);
      }

      return { success: true };
      
    } catch (err) {
      console.error('❌ Erreur socialAction:', err);
      throw err;
    }
  }, [address]);

  /**
   * 📊 Charger les statistiques (adapté pour réseau social)
   */
  const loadStats = useCallback(async () => {
    if (!address) return null;
    
    try {
      setLoading(true);
      console.log('📊 Chargement stats pour:', address.slice(0, 8) + '...' + address.slice(-6));
      
      const stats = await getUserStats(address);
      console.log('✅ Stats récupérées:', stats);
      
      return stats;
    } catch (err) {
      console.error('❌ Erreur chargement stats:', err);
      setError('Erreur chargement stats : ' + err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address]);

  return {
    address,
    btcBalance,
    btcUnconfirmed,
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    verificationStatus,
    setAddress,
    setError,
    checkBitcoinBalance,
    startGame,
    saveGameScore, 
    publishMessage: publishMessageCallback,
    loadMessages,
    loadUserMessages,
    manualSync,
    loadStats,
    loadCanvasPixels,
    submitCanvasPixels,
    loadUserPixelCount,
    loadComments,
    socialAction
  };
};