// ========================================
// EDGE FUNCTION : user-operations
// Gère toutes les opérations utilisateur AVEC vérification JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const JWT_SECRET = Deno.env.get('SUP_JWT_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// === CONSTANTES ===
const GAME_COST = 0.000001; // 0.000001 BTC (6 zéros)

// === VÉRIFICATION JWT ===
async function verifyJWT(token: string): Promise<{ valid: boolean; address?: string }> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const payload = await verify(token, key);
    
    console.log('✅ JWT valide pour:', (payload.address as string).slice(0, 15) + '...');
    return { valid: true, address: payload.address as string };
    
  } catch (error: any) {
    console.error('❌ JWT invalide:', error.message);
    return { valid: false };
  }
}

// === RÉCUPÉRATION BALANCE BITCOIN ===
async function fetchBitcoinBalance(address: string, network: string): Promise<number> {
  let apiUrl: string;
  
  if (network === 'testnet4') {
    apiUrl = `https://mempool.space/testnet4/api/address/${address}`;
  } else if (network === 'testnet' || network === 'testnet3') {
    apiUrl = `https://mempool.space/testnet/api/address/${address}`;
  } else {
    apiUrl = `https://mempool.space/api/address/${address}`;
  }

  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    if (response.status === 404) {
      return 0;
    }
    throw new Error('Erreur API Mempool.space');
  }

  const data = await response.json();
  const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  return confirmedBalance / 100000000;
}

// ========================================
// OPÉRATION 1 : SYNC BALANCE
// ========================================
async function syncBalance(address: string, network: string) {
  console.log('🔄 [SYNC] Démarrage pour:', address.slice(0, 15) + '...');
  
  try {
    const newBtcBalance = await fetchBitcoinBalance(address, network);
    console.log('💰 Solde BTC détecté:', newBtcBalance);

    const { data: user, error: fetchError } = await supabase
      .from('user_balances')
      .select('btc_balance, wbtc_balance, wbtc_spent_total')
      .eq('bitcoin_address', address)
      .single();

    if (fetchError || !user) {
      throw new Error('Utilisateur non trouvé');
    }

    const oldBtc = user.btc_balance || 0;
    const delta = newBtcBalance - oldBtc;
    const newWbtc = Math.max(0, (user.wbtc_balance || 0) + delta);

    console.log('📊 Delta BTC:', delta);

    const { data: updatedUser, error: updateError } = await supabase
      .from('user_balances')
      .update({
        btc_balance: newBtcBalance,
        wbtc_balance: newWbtc,
        last_sync: new Date().toISOString()
      })
      .eq('bitcoin_address', address)
      .select()
      .single();

    if (updateError) throw updateError;

    if (delta !== 0) {
      await supabase.from('transactions').insert({
        bitcoin_address: address,
        amount: delta,
        type: 'sync',
        created_at: new Date().toISOString()
      });
    }

    console.log('✅ [SYNC] Terminé');
    
    return {
      success: true,
      user: updatedUser,
      delta: delta
    };
    
  } catch (error: any) {
    console.error('❌ [SYNC] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 2 : DEDUCT (Déduire wBTC)
// ========================================
async function deductWBTC(address: string, amount: number) {
  console.log('💳 [DEDUCT] Déduction de', amount, 'wBTC pour:', address.slice(0, 15) + '...');
  
  try {
    const { data: user, error: fetchError } = await supabase
      .from('user_balances')
      .select('wbtc_balance, wbtc_spent_total, btc_balance, last_sync')
      .eq('bitcoin_address', address)
      .single();

    if (fetchError || !user) {
      throw new Error('Utilisateur non trouvé');
    }

    if (user.wbtc_balance < amount) {
      throw new Error(`Solde insuffisant. Requis: ${amount}, Disponible: ${user.wbtc_balance}`);
    }

    const newWbtc = user.wbtc_balance - amount;
    const newSpent = (user.wbtc_spent_total || 0) + amount;

    const { data: updatedUser, error: updateError } = await supabase
      .from('user_balances')
      .update({
        wbtc_balance: newWbtc,
        wbtc_spent_total: newSpent,
        last_sync: new Date().toISOString()
      })
      .eq('bitcoin_address', address)
      .eq('last_sync', user.last_sync) // Lock optimiste
      .select()
      .single();

    if (updateError) throw updateError;

    if (!updatedUser) {
      throw new Error('Conflit de synchronisation. Réessayez.');
    }

    await supabase.from('transactions').insert({
      bitcoin_address: address,
      amount: -amount,
      type: 'game',
      game_score: null,
      created_at: new Date().toISOString()
    });

    console.log('✅ [DEDUCT] Terminé');
    
    return {
      success: true,
      user: updatedUser
    };
    
  } catch (error: any) {
    console.error('❌ [DEDUCT] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 3 : SAVE_SCORE
// ========================================
async function saveScore(address: string, score: number) {
  console.log('💾 [SAVE_SCORE] Score:', score, 'pour:', address.slice(0, 15) + '...');
  
  try {
    const { data: lastGame, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('bitcoin_address', address)
      .eq('type', 'game')
      .is('game_score', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !lastGame) {
      console.warn('⚠️ Aucune partie à scorer');
      return { success: true, message: 'Aucune partie à scorer' };
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ game_score: score })
      .eq('id', lastGame.id);

    if (updateError) throw updateError;

    console.log('✅ [SAVE_SCORE] Terminé');
    
    return {
      success: true,
      message: 'Score enregistré'
    };
    
  } catch (error: any) {
    console.error('❌ [SAVE_SCORE] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 4 : GET_HISTORY
// ========================================
async function getHistory(address: string, limit: number = 20) {
  console.log('📜 [GET_HISTORY] Récupération pour:', address.slice(0, 15) + '...');
  
  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('bitcoin_address', address)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    console.log(`✅ [GET_HISTORY] ${transactions?.length || 0} transactions`);
    
    return {
      success: true,
      transactions: transactions || []
    };
    
  } catch (error: any) {
    console.error('❌ [GET_HISTORY] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 5 : GET_STATS
// ========================================
async function getStats(address: string) {
  console.log('📊 [GET_STATS] Récupération pour:', address.slice(0, 15) + '...');
  
  try {
    const { data: balance, error: balanceError } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    if (balanceError) throw balanceError;

    const { data: games, error: gamesError } = await supabase
      .from('transactions')
      .select('game_score')
      .eq('bitcoin_address', address)
      .eq('type', 'game')
      .not('game_score', 'is', null);

    if (gamesError) throw gamesError;

    const totalGames = games?.length || 0;
    const bestScore = totalGames > 0 
      ? Math.max(...games.map((g: any) => g.game_score)) 
      : 0;
    const avgScore = totalGames > 0
      ? games.reduce((sum: number, g: any) => sum + g.game_score, 0) / totalGames
      : 0;

    console.log('✅ [GET_STATS] Terminé');
    
    return {
      success: true,
      stats: {
        btc_balance: balance.btc_balance,
        wbtc_available: balance.wbtc_balance,
        wbtc_spent_total: balance.wbtc_spent_total || 0,
        total_games: totalGames,
        best_score: bestScore,
        average_score: Math.round(avgScore),
        games_remaining: Math.floor(balance.wbtc_balance / GAME_COST)
      }
    };
    
  } catch (error: any) {
    console.error('❌ [GET_STATS] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// HANDLER PRINCIPAL
// ========================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { operation, jwt, address, network, amount, score, limit } = body;

    console.log('🔧 [HANDLER] Opération:', operation);

    // Validation JWT
    if (!jwt) {
      throw new Error('JWT manquant');
    }

    const jwtVerification = await verifyJWT(jwt);
    
    if (!jwtVerification.valid) {
      return new Response(
        JSON.stringify({ success: false, error: 'JWT invalide ou expiré' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Vérifier que l'adresse correspond au JWT
    if (jwtVerification.address !== address) {
      return new Response(
        JSON.stringify({ success: false, error: 'Adresse non autorisée' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Router selon l'opération
    let result;
    
    switch (operation) {
      case 'sync':
        if (!network) throw new Error('Paramètre "network" manquant');
        result = await syncBalance(address, network);
        break;
      
      case 'deduct':
        if (!amount) throw new Error('Paramètre "amount" manquant');
        result = await deductWBTC(address, amount);
        break;
      
      case 'save_score':
        if (score === undefined) throw new Error('Paramètre "score" manquant');
        result = await saveScore(address, score);
        break;
      
      case 'get_history':
        result = await getHistory(address, limit || 20);
        break;
      
      case 'get_stats':
        result = await getStats(address);
        break;
      
      default:
        throw new Error(`Opération inconnue: ${operation}`);
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ [HANDLER] Erreur:', error.message);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});