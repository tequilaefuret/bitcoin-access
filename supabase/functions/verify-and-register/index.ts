// ========================================
// EDGE FUNCTION : verify-and-register (BIP-322 ONLY)
// Vérifie signature Bitcoin + Crée compte + Génère JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create } from 'https://deno.land/x/djwt@v2.8/mod.ts';
import { Verifier } from 'npm:bip322-js@3.0.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const JWT_SECRET = Deno.env.get('SUP_JWT_SECRET') ?? '';
const JWT_EXPIRATION = Deno.env.get('SUP_JWT_EXPIRATION') ?? '7d';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========================================
// TYPES
// ========================================
type AddressType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
type Network = 'mainnet' | 'testnet' | 'regtest';

interface VerificationResult {
  isValid: boolean;
  addressType: AddressType;
  network: Network;
  error?: string;
}

// ========================================
// DÉTECTION TYPE ADRESSE
// ========================================
function detectAddressType(address: string): { type: AddressType; network: Network } {
  // Taproot
  if (address.startsWith('bc1p')) {
    return { type: 'p2tr', network: 'mainnet' };
  }
  if (address.startsWith('tb1p')) {
    return { type: 'p2tr', network: 'testnet' };
  }
  if (address.startsWith('bcrt1p')) {
    return { type: 'p2tr', network: 'regtest' };
  }

  // SegWit Native (P2WPKH vs P2WSH)
  if (address.startsWith('bc1q')) {
    return { 
      type: address.length <= 45 ? 'p2wpkh' : 'p2wsh', 
      network: 'mainnet' 
    };
  }
  if (address.startsWith('tb1q') || address.startsWith('bcrt1q')) {
    const network = address.startsWith('tb1q') ? 'testnet' : 'regtest';
    return { 
      type: address.length <= 45 ? 'p2wpkh' : 'p2wsh', 
      network 
    };
  }

  // P2SH
  if (address.startsWith('3') || address.startsWith('2')) {
    return { 
      type: 'p2sh', 
      network: address.startsWith('3') ? 'mainnet' : 'testnet' 
    };
  }

  // P2PKH Legacy
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    const network = address.startsWith('1') ? 'mainnet' : 'testnet';
    return { type: 'p2pkh', network };
  }

  throw new Error(`Format d'adresse non reconnu: ${address}`);
}

// ========================================
// VÉRIFICATION BIP-322 (UNIVERSAL)
// ========================================
function verifyBitcoinSignature(
  address: string, 
  message: string, 
  signature: string
): VerificationResult {
  
  if (!address || !message || !signature) {
    return {
      isValid: false,
      addressType: 'p2pkh',
      network: 'mainnet',
      error: 'Paramètres manquants'
    };
  }

  let addressInfo: { type: AddressType; network: Network };
  
  try {
    addressInfo = detectAddressType(address);
  } catch (err) {
    return {
      isValid: false,
      addressType: 'p2pkh',
      network: 'mainnet',
      error: err instanceof Error ? err.message : 'Adresse invalide'
    };
  }

  console.log('🔍 Type adresse:', addressInfo.type);
  console.log('🔍 Réseau:', addressInfo.network);

  // ✅ BIP-322 supporte TOUS les formats (legacy, segwit, taproot)
  try {
    console.log('🔐 Vérification BIP-322...');
    
    // Le 3ème paramètre (false) permet d'accepter les signatures legacy aussi
    const isValid = Verifier.verifySignature(address, message, signature, false);
    
    if (isValid) {
      console.log('✅ Signature BIP-322 valide');
      return {
        isValid: true,
        addressType: addressInfo.type,
        network: addressInfo.network
      };
    } else {
      console.log('❌ Signature BIP-322 invalide');
      return {
        isValid: false,
        addressType: addressInfo.type,
        network: addressInfo.network,
        error: 'Signature invalide'
      };
    }
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur BIP-322:', errorMessage);
    
    return {
      isValid: false,
      addressType: addressInfo.type,
      network: addressInfo.network,
      error: `Erreur de vérification: ${errorMessage}`
    };
  }
}

// ========================================
// GÉNÉRATION JWT
// ========================================
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
    
    console.log('✅ JWT généré');
    return jwt;
    
  } catch (error: any) {
    console.error('❌ Erreur JWT:', error.message);
    throw new Error('Échec génération JWT');
  }
}

function parseExpiration(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60;
  
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

// ========================================
// RÉCUPÉRATION BALANCE BITCOIN
// ========================================
async function fetchBitcoinBalance(address: string, network: string): Promise<number> {
  let apiUrl: string;
  
  if (network === 'testnet4' || network === 'testnet' || network === 'testnet3') {
    apiUrl = `https://mempool.space/testnet4/api/address/${address}`;
  } else {
    apiUrl = `https://mempool.space/api/address/${address}`;
  }

  console.log('🌐 [FETCH_BALANCE] URL:', apiUrl);

  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    if (response.status === 404) {
      console.log('⚠️ [FETCH_BALANCE] Adresse non trouvée (404)');
      return 0;
    }
    throw new Error(`Erreur API Mempool.space: ${response.status}`);
  }

  const data = await response.json();
  
  // ✅ LOGS DE DEBUG CRITIQUES
  console.log('📊 [FETCH_BALANCE] Réponse complète:', JSON.stringify(data, null, 2));
  console.log('💰 [FETCH_BALANCE] funded_txo_sum:', data.chain_stats.funded_txo_sum);
  console.log('💸 [FETCH_BALANCE] spent_txo_sum:', data.chain_stats.spent_txo_sum);
  console.log('🧮 [FETCH_BALANCE] Différence (satoshis):', data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum);
  
  const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const confirmedBalanceBTC = confirmedBalance / 100000000;
  
  console.log('✅ [FETCH_BALANCE] Balance finale (BTC):', confirmedBalanceBTC);
  
  return confirmedBalanceBTC;
}

// ========================================
// HANDLER PRINCIPAL
// ========================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { address, message, signature, network } = await req.json();

    console.log('🔐 [VERIFY-AND-REGISTER] Démarrage...');
    console.log('📍 Adresse:', address);
    console.log('🌐 Réseau:', network);

    if (!address || !message || !signature || !network) {
      throw new Error('Paramètres manquants');
    }

    // Vérifier la signature avec BIP-322 (supporte tous les formats)
    const verification = verifyBitcoinSignature(address, message, signature);
    
    if (!verification.isValid) {
      throw new Error(
        verification.error || 
        'Signature invalide. La preuve de propriété a échoué.'
      );
    }

    console.log('✅ Signature vérifiée');
    console.log('📊 Type:', verification.addressType);
    console.log('📊 Réseau:', verification.network);

    // Vérifier solde BTC
    const btcBalance = await fetchBitcoinBalance(address, network);
    console.log('💰 Solde BTC:', btcBalance);

    // Vérifier si utilisateur existe
    const { data: existingUser } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    let userData;

    if (existingUser) {
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
            addressType: verification.addressType,
            network: verification.network
          },
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

      userData = updatedUser;
      console.log('✅ Utilisateur mis à jour');
      
    } else {
      console.log('🆕 Nouvel utilisateur, création...');
      
      const { data: newUser, error: insertError } = await supabase
        .from('user_balances')
        .insert({
          bitcoin_address: address,
          btc_balance: btcBalance,
          wbtc_balance: btcBalance,
          wbtc_spent_total: 0,
          signature_proof: {
            message: message,
            signature: signature,
            timestamp: Date.now(),
            verified: true,
            verified_at: new Date().toISOString(),
            addressType: verification.addressType,
            network: verification.network
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

    // Générer JWT
    const jwt = await generateJWT(address);

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