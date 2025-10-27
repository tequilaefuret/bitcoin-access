// ========================================
// EDGE FUNCTION : verify-and-register
// Vérifie signature Bitcoin + Crée compte + Génère JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create } from 'https://deno.land/x/djwt@v2.8/mod.ts';
import * as bitcoinjsMessage from 'npm:bitcoinjs-message@2.2.0';
import { Buffer } from 'https://deno.land/std@0.168.0/node/buffer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const JWT_SECRET = Deno.env.get('SUP_JWT_SECRET') ?? '';
const JWT_EXPIRATION = Deno.env.get('SUP_JWT_EXPIRATION') ?? '7d'; // Défaut: 7 jours

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// === GÉNÉRATION JWT ===
async function generateJWT(address: string): Promise<string> {
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

    // Calcul de l'expiration
    let exp: number | undefined;
    if (JWT_EXPIRATION !== 'never') {
      const now = Math.floor(Date.now() / 1000);
      const duration = parseExpiration(JWT_EXPIRATION);
      exp = now + duration;
    }

    const payload = {
      address: address,
      iat: Math.floor(Date.now() / 1000),
      ...(exp && { exp })
    };

    const jwt = await create({ alg: 'HS256', typ: 'JWT' }, payload, key);
    
    console.log('✅ JWT généré avec succès');
    return jwt;
    
  } catch (error: any) {
    console.error('❌ Erreur génération JWT:', error.message);
    throw new Error('Échec génération JWT');
  }
}

// Helper: Parser durée d'expiration
function parseExpiration(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60; // Défaut: 7 jours
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  const multipliers: { [key: string]: number } = {
    's': 1,
    'm': 60,
    'h': 60 * 60,
    'd': 24 * 60 * 60
  };
  
  return value * multipliers[unit];
}

// === VÉRIFICATION SIGNATURE BITCOIN ===
function verifyBitcoinSignature(address: string, message: string, signature: string): boolean {
  try {
    console.log('🔐 Vérification signature Bitcoin...');
    console.log('📍 Adresse:', address);
    console.log('📝 Message:', message.substring(0, 50) + '...');
    
    const signatureBuffer = Buffer.from(signature, 'base64');
    const isValid = bitcoinjsMessage.verify(message, address, signatureBuffer);
    
    console.log(isValid ? '✅ Signature valide' : '❌ Signature invalide');
    return isValid;
    
  } catch (error: any) {
    console.error('❌ Erreur vérification signature:', error.message);
    return false;
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
      return 0; // Adresse valide mais sans transactions
    }
    throw new Error('Erreur API Mempool.space');
  }

  const data = await response.json();
  const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  return confirmedBalance / 100000000;
}

// === DÉTECTION TYPE D'ADRESSE ===
function detectAddressType(address: string): string {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return 'P2TR (Taproot)';
  } else if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
    return 'P2WPKH (SegWit)';
  } else if (address.startsWith('3') || address.startsWith('2')) {
    return 'P2SH (SegWit wrappé)';
  } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return 'P2PKH (Legacy)';
  }
  return 'Unknown';
}

// === HANDLER PRINCIPAL ===
serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { address, message, signature, network } = await req.json();

    console.log('🔐 [VERIFY-AND-REGISTER] Démarrage...');
    console.log('📍 Adresse:', address);
    console.log('🌐 Réseau:', network);

    // 1. Validation paramètres
    if (!address || !message || !signature || !network) {
      throw new Error('Paramètres manquants (address, message, signature, network)');
    }

    // 2. Détecter type d'adresse
    const addressType = detectAddressType(address);
    console.log('🏷️ Type adresse:', addressType);

    // 3. Bloquer Taproot (non supporté par bitcoinjs-message)
    if (addressType.includes('Taproot')) {
      throw new Error(
        'Les adresses Taproot (bc1p/tb1p) ne sont pas encore supportées par bitcoinjs-message. ' +
        'Veuillez utiliser une adresse SegWit (bc1q) ou Legacy.'
      );
    }

    // 4. Vérifier la signature cryptographiquement
    const isValidSignature = verifyBitcoinSignature(address, message, signature);
    
    if (!isValidSignature) {
      throw new Error('Signature Bitcoin invalide. La preuve de propriété a échoué.');
    }

    console.log('✅ Signature cryptographique vérifiée');

    // 5. Vérifier solde BTC réel
    const btcBalance = await fetchBitcoinBalance(address, network);
    console.log('💰 Solde BTC détecté:', btcBalance);

    // 6. Vérifier si utilisateur existe
    const { data: existingUser } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    let userData;

    if (existingUser) {
      // 7a. Utilisateur existe → UPDATE
      console.log('👤 Utilisateur existant, mise à jour...');
      
      const oldBtc = existingUser.btc_balance || 0;
      const delta = btcBalance - oldBtc;
      const newWbtc = Math.max(0, (existingUser.wbtc_balance || 0) + delta);

      const { data: updatedUser, error: updateError } = await supabase
        .from('user_balances')
        .update({
          btc_balance: btcBalance,
          wbtc_balance: newWbtc,
          signature_proof: {
            message: message,
            signature: signature,
            timestamp: Date.now(),
            verified: true,
            verified_at: new Date().toISOString(),
            addressType: addressType
          },
          last_sync: new Date().toISOString()
        })
        .eq('bitcoin_address', address)
        .select()
        .single();

      if (updateError) throw updateError;

      // Créer transaction si delta != 0
      if (delta !== 0) {
        await supabase.from('transactions').insert({
          bitcoin_address: address,
          amount: delta,
          type: 'sync',
          created_at: new Date().toISOString()
        });
      }

      userData = updatedUser;
      console.log('✅ Utilisateur mis à jour');
      
    } else {
      // 7b. Nouvel utilisateur → INSERT
      console.log('🆕 Nouvel utilisateur, création compte...');
      
      const { data: newUser, error: insertError } = await supabase
        .from('user_balances')
        .insert({
          bitcoin_address: address,
          btc_balance: btcBalance,
          wbtc_balance: btcBalance, // Initialisation 1:1
          wbtc_spent_total: 0,
          signature_proof: {
            message: message,
            signature: signature,
            timestamp: Date.now(),
            verified: true,
            verified_at: new Date().toISOString(),
            addressType: addressType
          },
          last_sync: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) throw insertError;

      userData = newUser;
      console.log('✅ Compte créé');
    }

    // 8. Générer JWT
    const jwt = await generateJWT(address);

    // 9. Retourner résultat complet
    return new Response(
      JSON.stringify({
        valid: true,
        jwt: jwt,
        user: userData
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ [VERIFY-AND-REGISTER] Erreur:', error.message);
    
    return new Response(
      JSON.stringify({ 
        valid: false, 
        error: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});