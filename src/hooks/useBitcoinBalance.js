// src/hooks/useBitcoinBalance.js - VERSION AVEC MODE TEST LOCAL
import { useState, useCallback } from 'react';
import { 
  verifyAndRegister,
  syncUserBalance,
  deductGameCost,
  saveGameScore,
  getTransactionHistory,
  getUserStats
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

      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        if (response.status === 404) {
          return { confirmed: 0, unconfirmed: 0, total: 0 };
        }
        throw new Error('API_ERROR');
      }
      
      const data = await response.json();
      const confirmedBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
      const unconfirmedBalance = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum) / 100000000;
      
      return {
        confirmed: confirmedBalance,
        unconfirmed: unconfirmedBalance,
        total: confirmedBalance + unconfirmedBalance
      };
    } catch (error) {
      console.error('Erreur fetchConfirmedBalance:', error);
      throw error;
    }
  };

  /**
   * 🔐 Vérifier solde Bitcoin + Signature (si fournie)
   */
  const checkBitcoinBalance = useCallback(async (bitcoinAddress, signatureData = null, isTestMode = false) => {
    console.log('🔍 checkBitcoinBalance appelé avec:', { 
      bitcoinAddress, 
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
   * 🎮 Démarrer une partie (MODE TEST : gestion locale)
   */
  const startGame = useCallback(async (isTestMode = false) => {
    console.log('🎮 Démarrage partie - Mode test:', isTestMode);
    
    try {
      const gameCost = 0.000001;
      
      // 🆕 MODE TEST : Déduction locale sans BDD
      if (isTestMode) {
        const testBalanceStr = sessionStorage.getItem('test_balance');
        if (!testBalanceStr) {
          throw new Error('Balance test non trouvée');
        }
        
        const testBalance = JSON.parse(testBalanceStr);
        
        if (testBalance.wbtc < gameCost) {
          throw new Error('Solde wBTC insuffisant');
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
      
      if (result.success && result.user) {
        setWbtcAvailable(result.user.wbtc_balance);
        setWbtcSpentTotal(result.user.wbtc_spent_total);
      }
      
      return true;
      
    } catch (err) {
      console.error('❌ Erreur démarrage partie:', err);
      setError(err.message);
      return false;
    }
  }, [address]);

  /**
   * 🔄 Synchroniser balance (authentifié uniquement)
   */
  const manualSync = useCallback(async () => {
    if (!address) return;
    
    try {
      setLoading(true);
      setError('');
      
      const bitcoinNetwork = process.env.REACT_APP_BITCOIN_NETWORK || 'testnet4';
      const network = (bitcoinNetwork === 'bitcoin' || bitcoinNetwork === 'mainnet') ? 'mainnet' : 'testnet';
      
      const result = await syncUserBalance(address, network);
      
      if (result.success && result.user) {
        //const oldBTC = btcBalance;
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
  }, [address, btcBalance]);

  /**
   * 📜 Charger l'historique (authentifié uniquement)
   */
  const loadHistory = useCallback(async () => {
    if (!address) return [];
    
    try {
      setLoading(true);
      const history = await getTransactionHistory(address, 20);
      return history;
    } catch (err) {
      console.error('❌ Erreur chargement historique:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 📊 Charger les statistiques (authentifié uniquement)
   */
  const loadStats = useCallback(async () => {
    if (!address) return null;
    
    try {
      setLoading(true);
      const stats = await getUserStats(address);
      return stats;
    } catch (err) {
      console.error('❌ Erreur chargement stats:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 💾 Sauvegarder le score (authentifié uniquement)
   */
  const saveGameScoreCallback = useCallback(async (score) => {
    try {
      await saveGameScore(address, score);
    } catch (err) {
      console.error('❌ Erreur sauvegarde score:', err);
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
    manualSync,
    loadHistory,
    loadStats,
    saveGameScore: saveGameScoreCallback,
  };
};