// ========================================
// EDGE FUNCTION : verify-and-register (VERSION COMPLÈTE AVEC BIP-322)
// Vérifie signature Bitcoin + Crée compte + Génère JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create } from 'https://deno.land/x/djwt@v2.8/mod.ts';
import { Buffer } from 'https://deno.land/std@0.168.0/node/buffer.ts';

// Import librairies de vérification
import * as bitcoinjsMessage from 'npm:bitcoinjs-message@2.2.0';
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
type SignatureFormat = 'legacy-ecdsa' | 'bip322-simple' | 'bip322-full' | 'unknown';
type Network = 'mainnet' | 'testnet' | 'regtest';

interface VerificationResult {
  isValid: boolean;
  addressType: AddressType;
  signatureFormat: SignatureFormat;
  method: string;
  error?: string;
}

// ========================================
// DÉTECTION TYPE ADRESSE (AMÉLIORÉ)
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
// DÉTECTION FORMAT SIGNATURE (CORRIGÉ)
// ========================================
function detectSignatureFormat(signature: string): SignatureFormat {
  let decoded: Buffer;
  
  try {
    decoded = Buffer.from(signature, 'base64');
  } catch {
    return 'unknown';
  }

  // Signature ECDSA classique (65 bytes)
  if (decoded.length === 65) {
    const header = decoded[0];
    
    if ((header >= 27 && header <= 34) ||
        (header >= 35 && header <= 38) ||
        (header >= 39 && header <= 42)) {
      return 'legacy-ecdsa';
    }
  }

  // BIP-322 Simple
  if (decoded.length > 0 && decoded.length < 200) {
    const firstByte = decoded[0];
    if (firstByte >= 1 && firstByte <= 3) {
      return 'bip322-simple';
    }
  }

  // BIP-322 Full
  if (decoded.length >= 200) {
    if (decoded.length > 4) {
      const version = decoded.readUInt32LE(0);
      if (version === 1 || version === 2) {
        return 'bip322-full';
      }
    }
  }

  return 'unknown';
}

// ========================================
// VÉRIFICATION BIP-322
// ========================================
function verifyBIP322(
  address: string, 
  message: string, 
  signature: string
): { isValid: boolean; error?: string } {
  try {
    const isValid = Verifier.verifySignature(address, message, signature, false);
    return { isValid };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur BIP-322:', errorMessage);
    return { isValid: false, error: errorMessage };
  }
}

// ========================================
// VÉRIFICATION LEGACY
// ========================================
function verifyLegacy(
  address: string, 
  message: string, 
  signature: string,
  addressType: AddressType
): { isValid: boolean; error?: string } {
  try {
    const signatureBuffer = Buffer.from(signature, 'base64');
    
    const header = signatureBuffer[0];
    
    if (header < 27 || header > 42) {
      return { 
        isValid: false, 
        error: `Header invalide: ${header}. Attendu: 27-42` 
      };
    }

    const checkSegwitAlways = (addressType === 'p2wpkh' || addressType === 'p2sh');
    
    const isValid = bitcoinjsMessage.verify(
      message, 
      address, 
      signatureBuffer,
      null,
      checkSegwitAlways
    );
    
    return { isValid };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur Legacy:', errorMessage);
    return { isValid: false, error: errorMessage };
  }
}

// ========================================
// ROUTEUR PRINCIPAL DE VÉRIFICATION
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
      signatureFormat: 'unknown',
      method: 'none',
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
      signatureFormat: 'unknown',
      method: 'none',
      error: err instanceof Error ? err.message : 'Adresse invalide'
    };
  }

  const signatureFormat = detectSignatureFormat(signature);

  console.log('🔍 Type adresse:', addressInfo.type);
  console.log('🔍 Réseau:', addressInfo.network);
  console.log('🔍 Format signature:', signatureFormat);

  // === RÈGLES DE ROUTAGE ===

  // RÈGLE 1 : Taproot → OBLIGATOIREMENT BIP-322
  if (addressInfo.type === 'p2tr') {
    if (signatureFormat === 'legacy-ecdsa') {
      return {
        isValid: false,
        addressType: addressInfo.type,
        signatureFormat,
        method: 'none',
        error: 'Les adresses Taproot nécessitent des signatures BIP-322'
      };
    }
    
    const result = verifyBIP322(address, message, signature);
    return {
      isValid: result.isValid,
      addressType: addressInfo.type,
      signatureFormat,
      method: 'bip322',
      error: result.error
    };
  }

  // RÈGLE 2 : P2WSH → OBLIGATOIREMENT BIP-322
  if (addressInfo.type === 'p2wsh') {
    const result = verifyBIP322(address, message, signature);
    return {
      isValid: result.isValid,
      addressType: addressInfo.type,
      signatureFormat,
      method: 'bip322',
      error: result.error
    };
  }

  // RÈGLE 3 : Signature BIP-322 détectée
  if (signatureFormat === 'bip322-simple' || signatureFormat === 'bip322-full') {
    const result = verifyBIP322(address, message, signature);
    return {
      isValid: result.isValid,
      addressType: addressInfo.type,
      signatureFormat,
      method: 'bip322',
      error: result.error
    };
  }

  // RÈGLE 4 : Signature ECDSA Legacy
  if (signatureFormat === 'legacy-ecdsa') {
    const result = verifyLegacy(address, message, signature, addressInfo.type);
    return {
      isValid: result.isValid,
      addressType: addressInfo.type,
      signatureFormat,
      method: 'legacy',
      error: result.error
    };
  }

  // RÈGLE 5 : Format inconnu → Tentative gracieuse
  console.warn('⚠️ Format inconnu, tentative avec les deux méthodes');
  
  const bip322Result = verifyBIP322(address, message, signature);
  if (bip322Result.isValid) {
    return {
      isValid: true,
      addressType: addressInfo.type,
      signatureFormat: 'bip322-simple',
      method: 'bip322'
    };
  }

  const legacyResult = verifyLegacy(address, message, signature, addressInfo.type);
  return {
    isValid: legacyResult.isValid,
    addressType: addressInfo.type,
    signatureFormat: legacyResult.isValid ? 'legacy-ecdsa' : 'unknown',
    method: legacyResult.isValid ? 'legacy' : 'none',
    error: legacyResult.error || bip322Result.error
  };
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

    // Vérifier la signature avec routeur intelligent
    const verification = verifyBitcoinSignature(address, message, signature);
    
    if (!verification.isValid) {
      throw new Error(
        verification.error || 
        'Signature invalide. La preuve de propriété a échoué.'
      );
    }

    console.log('✅ Signature vérifiée');
    console.log('📊 Type:', verification.addressType);
    console.log('📊 Format:', verification.signatureFormat);
    console.log('📊 Méthode:', verification.method);

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
            signatureFormat: verification.signatureFormat,
            verificationMethod: verification.method
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
            signatureFormat: verification.signatureFormat,
            verificationMethod: verification.method
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