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
const MESSAGE_COST_PER_CHAR = 0.00000001; // 1 satoshi par caractère

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
    
    const addressTrunc = (payload.address as string).slice(0, 8) + '...' + (payload.address as string).slice(-6);
    console.log('✅ JWT valide pour:', addressTrunc);
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
  const addressTrunc = address.slice(0, 8) + '...' + address.slice(-6);
  console.log('🔄 [SYNC] Démarrage pour:', addressTrunc);
  
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
// OPÉRATION 2 : PUBLISH_MESSAGE
// ========================================
async function publishMessage(address: string, content: string, parentId?: string) {
  const addressTrunc = address.slice(0, 8) + '...' + address.slice(-6);
  console.log('📝 [PUBLISH_MESSAGE] Nouveau message de:', addressTrunc);
  
  try {
    // Calculer coût (espaces comptent, pas les retours à la ligne)
    const charCount = content.replace(/\n/g, '').length;
    const cost = charCount * MESSAGE_COST_PER_CHAR;
    
    console.log('📊 Caractères:', charCount, '| Coût:', cost, 'wBTC');
    
    // Vérifier solde
    const { data: user, error: fetchError } = await supabase
      .from('user_balances')
      .select('wbtc_balance, wbtc_spent_total, last_sync')
      .eq('bitcoin_address', address)
      .single();

    if (fetchError || !user) {
      throw new Error('Utilisateur non trouvé');
    }

    if (user.wbtc_balance < cost) {
      throw new Error(`Solde insuffisant. Requis: ${cost.toFixed(8)}, Disponible: ${user.wbtc_balance.toFixed(8)}`);
    }

    // Déduire wBTC
    const newWbtc = user.wbtc_balance - cost;
    const newSpent = (user.wbtc_spent_total || 0) + cost;

    const { data: updatedUser, error: updateError } = await supabase
      .from('user_balances')
      .update({
        wbtc_balance: newWbtc,
        wbtc_spent_total: newSpent,
        last_sync: new Date().toISOString()
      })
      .eq('bitcoin_address', address)
      .eq('last_sync', user.last_sync)
      .select()
      .single();

    if (updateError) throw updateError;

    if (!updatedUser) {
      throw new Error('Conflit de synchronisation. Réessayez.');
    }

    // Insérer message (avec parent_id optionnel pour commentaires)
    const insertData: any = {
      bitcoin_address: address,
      content: content,
      char_count: charCount,
      cost_wbtc: cost,
      created_at: new Date().toISOString()
    };

    // Si parentId fourni, c'est un commentaire
    if (parentId) {
      insertData.parent_id = parentId;
      console.log('💬 Commentaire du message:', parentId.slice(0, 8));
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert(insertData)
      .select()
      .single();

    if (messageError) throw messageError;

    // Enregistrer transaction
    await supabase.from('transactions').insert({
      bitcoin_address: address,
      amount: -cost,
      type: 'message',
      created_at: new Date().toISOString()
    });

    console.log('✅ [PUBLISH_MESSAGE] Message publié');
    
    return {
      success: true,
      message: message,
      user: updatedUser
    };
    
  } catch (error: any) {
    console.error('❌ [PUBLISH_MESSAGE] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 3 : GET_MESSAGES (tous les messages, public)
// REMPLACE la fonction getMessages dans user-operations/index.ts
// ========================================
async function getMessages(limit: number = 20, offset: number = 0, userAddress?: string, parentId?: string) {
  const parentInfo = parentId ? `Parent: ${parentId.slice(0, 8)}` : 'Posts principaux';
  console.log('📨 [GET_MESSAGES] Params reçus:', { limit, offset, userAddress: userAddress?.slice(0, 8), parentId });
  
  try {
    // Construction de la requête selon si on veut les posts ou les commentaires
    let query = supabase
      .from('messages')
      .select(`
        *,
        likes:message_likes(count),
        dislikes:message_dislikes(count),
        comments:messages!parent_id(count),
        reposts:messages!repost_of(count)
      `)
      .is('deleted_at', null);

    // Filtre : soit posts principaux (parent_id null), soit commentaires d'un message spécifique
    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: messages, error } = await query;

    if (error) throw error;

    // Si pas d'utilisateur, retourner sans vérifier likes/dislikes
    if (!userAddress) {
      const formatted = messages.map((msg: any) => ({
        ...msg,
        likes_count: msg.likes?.[0]?.count || 0,
        dislikes_count: msg.dislikes?.[0]?.count || 0,
        comments_count: msg.comments?.[0]?.count || 0,
        reposts_count: msg.reposts?.[0]?.count || 0,
        user_has_liked: false,
        user_has_disliked: false
      }));

      console.log(`✅ [GET_MESSAGES] ${formatted.length} messages (mode public)`);
      
      return {
        success: true,
        messages: formatted,
        count: formatted.length
      };
    }

    // Récupérer les likes/dislikes de l'utilisateur
    const messageIds = messages.map((m: any) => m.id);
    
    const { data: userLikes } = await supabase
      .from('message_likes')
      .select('message_id')
      .eq('bitcoin_address', userAddress)
      .in('message_id', messageIds);

    const { data: userDislikes } = await supabase
      .from('message_dislikes')
      .select('message_id')
      .eq('bitcoin_address', userAddress)
      .in('message_id', messageIds);

    // Formater avec toutes les infos
    const formatted = messages.map((msg: any) => ({
      ...msg,
      likes_count: msg.likes?.[0]?.count || 0,
      dislikes_count: msg.dislikes?.[0]?.count || 0,
      comments_count: msg.comments?.[0]?.count || 0,
      reposts_count: msg.reposts?.[0]?.count || 0,
      user_has_liked: userLikes?.some((l: any) => l.message_id === msg.id) || false,
      user_has_disliked: userDislikes?.some((d: any) => d.message_id === msg.id) || false
    }));

    console.log(`✅ [GET_MESSAGES] ${formatted.length} ${parentId ? 'commentaires' : 'messages'}`);
    
    return {
      success: true,
      messages: formatted,
      count: formatted.length
    };
    
  } catch (error: any) {
    console.error('❌ [GET_MESSAGES] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 4 : GET_USER_MESSAGES (historique utilisateur)
// ========================================
async function getUserMessages(address: string, limit: number = 20, offset: number = 0) {
  const addressTrunc = address.slice(0, 8) + '...' + address.slice(-6);
  console.log('📜 [GET_USER_MESSAGES] Récupération pour:', addressTrunc, '| Limit:', limit, '| Offset:', offset);
  
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('bitcoin_address', address)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    console.log(`✅ [GET_USER_MESSAGES] ${messages?.length || 0} messages récupérés`);
    
    return {
      success: true,
      messages: messages || [],
      count: messages?.length || 0
    };
    
  } catch (error: any) {
    console.error('❌ [GET_USER_MESSAGES] Erreur:', error.message);
    throw error;
  }
}

// ========================================
// OPÉRATION 5 : GET_STATS
// ========================================
async function getStats(address: string) {
  const addressTrunc = address.slice(0, 8) + '...' + address.slice(-6);
  console.log('📊 [GET_STATS] Récupération pour:', addressTrunc);
  
  try {
    const { data: balance, error: balanceError } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    if (balanceError) throw balanceError;

    // Compter messages publiés
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('cost_wbtc')
      .eq('bitcoin_address', address);

    if (messagesError) throw messagesError;

    const totalMessages = messages?.length || 0;
    const totalCost = messages?.reduce((sum: number, msg: any) => sum + parseFloat(msg.cost_wbtc), 0) || 0;
    const avgCost = totalMessages > 0 ? totalCost / totalMessages : 0;

    console.log('✅ [GET_STATS] Terminé');
    
    return {
      success: true,
      stats: {
        btc_balance: balance.btc_balance,
        wbtc_available: balance.wbtc_balance,
        wbtc_spent_total: balance.wbtc_spent_total || 0,
        total_messages: totalMessages,
        total_cost_messages: totalCost,
        average_cost_per_message: avgCost,
        characters_remaining: Math.floor(balance.wbtc_balance / MESSAGE_COST_PER_CHAR)
      }
    };
    
  } catch (error: any) {
    console.error('❌ [GET_STATS] Erreur:', error.message);
    throw error;
  }
}


// ========================================
// OPÉRATION 6 : DEDUCT (Déduire wBTC)
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
// OPÉRATION 7 : SAVE_SCORE
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
// OPÉRATION 8 : PLACE_PIXELS (Canvas)
// ========================================
async function placePixels(address: string, pixels: Array<{ x: number; y: number; color: string }>) {
  console.log(`🎨 [PLACE_PIXELS] Placement de ${pixels.length} pixels pour:`, address.slice(0, 15) + '...');
  
  try {
    // Validation des pixels
    if (!pixels || !Array.isArray(pixels) || pixels.length === 0) {
      throw new Error('Aucun pixel fourni');
    }

    if (pixels.length > 1000) {
      throw new Error('Maximum 1000 pixels par validation');
    }

    // Valider chaque pixel
    const validColors = [
      '#FFFFFF', '#E4E4E4', '#888888', '#222222',
      '#FFA7D1', '#E50000', '#E59500', '#A06A42',
      '#E5D900', '#94E044', '#02BE01', '#00D3DD',
      '#0083C7', '#0000EA', '#CF6EE4', '#820080'
    ];

    for (const pixel of pixels) {
      if (
        typeof pixel.x !== 'number' || pixel.x < 0 || pixel.x >= 100 ||
        typeof pixel.y !== 'number' || pixel.y < 0 || pixel.y >= 100 ||
        !validColors.includes(pixel.color)
      ) {
        throw new Error('Pixel invalide détecté');
      }
    }

    // Calcul du coût total
    const costPerPixel = 0.00000001;
    const totalCost = pixels.length * costPerPixel;

    console.log(`💰 Coût total: ${totalCost} wBTC`);

    // Vérifier le solde
    const { data: user, error: userError } = await supabase
      .from('user_balances')
      .select('wbtc_balance, wbtc_spent_total, last_sync')
      .eq('bitcoin_address', address)
      .single();

    if (userError || !user) {
      throw new Error('Utilisateur non trouvé');
    }

    if (user.wbtc_balance < totalCost) {
      throw new Error(`Solde insuffisant. Requis: ${totalCost} wBTC, Disponible: ${user.wbtc_balance} wBTC`);
    }

    // Récupérer les pixels existants pour détecter les conflits
    const { data: existingPixels, error: fetchError } = await supabase
      .from('canvas_pixels')
      .select('x, y, bitcoin_address, created_at')
      .in('x', pixels.map(p => p.x))
      .in('y', pixels.map(p => p.y));

    if (fetchError) {
      throw new Error('Erreur vérification conflits');
    }

    // Créer un map des pixels existants
    const existingMap = new Map(
      (existingPixels || []).map((p: any) => [`${p.x},${p.y}`, p])
    );

    // Séparer pixels valides et conflits
    const validPixels = [];
    const conflicts = [];
    const now = new Date().toISOString();

    for (const pixel of pixels) {
      const key = `${pixel.x},${pixel.y}`;
      const existing = existingMap.get(key);
      
      if (existing && existing.bitcoin_address !== address) {
        // Conflit : pixel appartient à quelqu'un d'autre
        conflicts.push(pixel);
      } else {
        // Pixel valide : soit nouveau, soit appartient déjà à l'utilisateur
        validPixels.push(pixel);
      }
    }

    if (validPixels.length === 0) {
      throw new Error(`Tous les pixels sont en conflit avec d'autres utilisateurs (${conflicts.length} conflits)`);
    }

    // Calculer le coût réel (seulement les pixels valides)
    const actualCost = validPixels.length * costPerPixel;

    // Débiter le solde
    const { data: updatedUser, error: updateError } = await supabase
      .from('user_balances')
      .update({
        wbtc_balance: user.wbtc_balance - actualCost,
        wbtc_spent_total: (user.wbtc_spent_total || 0) + actualCost,
        last_sync: now
      })
      .eq('bitcoin_address', address)
      .eq('last_sync', user.last_sync)
      .select()
      .single();

    if (updateError) {
      throw new Error('Erreur débit solde');
    }

    if (!updatedUser) {
      throw new Error('Conflit de synchronisation. Réessayez.');
    }

    // Insérer/Mettre à jour les pixels valides (UPSERT)
    const pixelsToUpsert = validPixels.map((p: any) => ({
      x: p.x,
      y: p.y,
      color: p.color,
      bitcoin_address: address,
      created_at: existingMap.has(`${p.x},${p.y}`) ? existingMap.get(`${p.x},${p.y}`).created_at : now,
      updated_at: now
    }));

    const { error: upsertError } = await supabase
      .from('canvas_pixels')
      .upsert(pixelsToUpsert, { onConflict: 'x,y' });

    if (upsertError) {
      console.error('❌ Erreur insertion pixels:', upsertError);
      // Rollback: rembourser l'utilisateur
      await supabase
        .from('user_balances')
        .update({
          wbtc_balance: user.wbtc_balance,
          wbtc_spent_total: user.wbtc_spent_total,
          last_sync: user.last_sync
        })
        .eq('bitcoin_address', address);

      throw new Error('Erreur placement pixels');
    }

    // Enregistrer la transaction
    await supabase.from('transactions').insert({
      bitcoin_address: address,
      amount: -actualCost,
      type: 'canvas',
      created_at: now
    });

    console.log(`✅ [PLACE_PIXELS] ${validPixels.length} pixels placés, ${conflicts.length} conflits rejetés`);

    return {
      success: true,
      user: updatedUser,
      pixelsPlaced: validPixels.length,
      conflicts: conflicts.length
    };
    
  } catch (error: any) {
    console.error('❌ [PLACE_PIXELS] Erreur:', error.message);
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
    const { operation, jwt, address, network, content, limit, offset, amount, score, pixels, parentId } = body;

    console.log('🔧 [HANDLER] Opération:', operation);
    console.log('🔍 [DEBUG] JWT reçu:', jwt ? 'OUI' : 'NON');
    console.log('🔍 [DEBUG] Address:', address);

    // ========================================
    // VALIDATION JWT OBLIGATOIRE (plus d'exception)
    // ========================================
    if (!jwt) {
      throw new Error('JWT manquant - Connexion requise');
    }

    const jwtVerification = await verifyJWT(jwt);
    
    if (!jwtVerification.valid) {
      return new Response(
        JSON.stringify({ success: false, error: 'JWT invalide ou expiré' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      
      case 'publish_message':
        if (!content) throw new Error('Paramètre "content" manquant');
        if (content.length > 1000) throw new Error('Message trop long (max 1000 caractères)');
        result = await publishMessage(address, content, parentId);
        break;
      
      case 'get_messages':
        console.log('📨 [GET_MESSAGES] Demande de chargement:', limit || 20, 'messages');
        
        // ÉTAPE 1 : Charger les messages d'abord pour connaître le nombre exact
        const messagesResult = await getMessages(limit || 20, offset || 0, address, body.parentId);
        
        if (!messagesResult.success) {
          throw new Error('Erreur chargement messages');
        }
        
        const actualCount = messagesResult.messages?.length || 0;
        const READ_COST_PER_MESSAGE = 0.00000001; // 1 satoshi par message
        const totalCost = actualCount * READ_COST_PER_MESSAGE;
        
        console.log(`💰 [GET_MESSAGES] ${actualCount} messages chargés → Coût: ${totalCost.toFixed(8)} wBTC`);
        
        // ÉTAPE 2 : Si pas de messages, pas de débit (gratuit)
        if (actualCount === 0) {
          console.log('ℹ️ [GET_MESSAGES] Aucun message → Gratuit');
          result = messagesResult;
          break;
        }
        
        // ÉTAPE 3 : Vérifier le solde
        const { data: user, error: balanceError } = await supabase
          .from('user_balances')
          .select('wbtc_balance, wbtc_spent_total, last_sync')
          .eq('bitcoin_address', address)
          .single();

        if (balanceError || !user) {
          throw new Error('Utilisateur non trouvé');
        }

        if (user.wbtc_balance < totalCost) {
          throw new Error(
            `Solde insuffisant pour charger ${actualCount} messages. ` +
            `Requis: ${totalCost.toFixed(8)} wBTC, Disponible: ${user.wbtc_balance.toFixed(8)} wBTC`
          );
        }

        // ÉTAPE 4 : Déduire le coût réel
        const { error: updateError } = await supabase
          .from('user_balances')
          .update({
            wbtc_balance: user.wbtc_balance - totalCost,
            wbtc_spent_total: (user.wbtc_spent_total || 0) + totalCost,
            last_sync: new Date().toISOString()
          })
          .eq('bitcoin_address', address)
          .eq('last_sync', user.last_sync); // Lock optimiste

        if (updateError) {
          console.error('❌ Erreur déduction:', updateError.message);
          throw new Error('Erreur déduction solde');
        }

        // ÉTAPE 5 : Enregistrer transaction
        await supabase.from('transactions').insert({
          bitcoin_address: address,
          amount: -totalCost,
          type: 'read_messages',
          created_at: new Date().toISOString()
        });

        console.log(`✅ [GET_MESSAGES] ${totalCost.toFixed(8)} wBTC déduit`);
        
        // ÉTAPE 6 : Retourner les messages + nouveau solde
        result = {
          ...messagesResult,
          new_balance: user.wbtc_balance - totalCost,
          cost: totalCost
        };
        break;
      
      case 'get_user_messages':
        result = await getUserMessages(address, limit || 20, offset || 0);
        break;
      
      case 'get_stats':
        result = await getStats(address);
        break;

      case 'place_pixels':
        result = await placePixels(address, pixels);
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