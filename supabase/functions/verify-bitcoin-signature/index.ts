// ========================================
// SUPABASE EDGE FUNCTION : verify-bitcoin-signature (BIP-322)
// Fichier : supabase/functions/verify-bitcoin-signature/index.ts
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Verifier } from 'npm:bip322-js@3.0.0';

// ========================================
// CONFIGURATION
// ========================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

// ========================================
// UTILITAIRES
// ========================================

/**
 * Détecte le type d'adresse Bitcoin
 */
function detectAddressType(address: string): { type: AddressType; network: Network; label: string } {
  // Taproot
  if (address.startsWith('bc1p')) {
    return { type: 'p2tr', network: 'mainnet', label: 'P2TR (Taproot)' };
  }
  if (address.startsWith('tb1p')) {
    return { type: 'p2tr', network: 'testnet', label: 'P2TR (Taproot)' };
  }

  // SegWit Native
  if (address.startsWith('bc1q')) {
    return { 
      type: address.length <= 45 ? 'p2wpkh' : 'p2wsh', 
      network: 'mainnet',
      label: address.length <= 45 ? 'P2WPKH (SegWit)' : 'P2WSH (SegWit)'
    };
  }
  if (address.startsWith('tb1q')) {
    return { 
      type: address.length <= 45 ? 'p2wpkh' : 'p2wsh', 
      network: 'testnet',
      label: address.length <= 45 ? 'P2WPKH (SegWit)' : 'P2WSH (SegWit)'
    };
  }

  // P2SH
  if (address.startsWith('3')) {
    return { type: 'p2sh', network: 'mainnet', label: 'P2SH' };
  }
  if (address.startsWith('2')) {
    return { type: 'p2sh', network: 'testnet', label: 'P2SH' };
  }

  // Legacy
  if (address.startsWith('1')) {
    return { type: 'p2pkh', network: 'mainnet', label: 'P2PKH (Legacy)' };
  }
  if (address.startsWith('m') || address.startsWith('n')) {
    return { type: 'p2pkh', network: 'testnet', label: 'P2PKH (Legacy)' };
  }

  throw new Error(`Format d'adresse non reconnu: ${address}`);
}

// ========================================
// VÉRIFICATION SIGNATURE
// ========================================

/**
 * Vérifie cryptographiquement une signature Bitcoin avec BIP-322
 * Supporte TOUS les types d'adresses : Legacy, SegWit, Taproot
 */
async function verifyBitcoinSignature(
  address: string,
  message: string,
  signature: string,
  network: string
): Promise<{ valid: boolean; error?: string; addressType?: string; addressLabel?: string }> {
  try {
    // 1. Détection du type d'adresse
    const addressInfo = detectAddressType(address);
    console.log(`🔍 Type d'adresse: ${addressInfo.label} (${address.slice(0, 10)}...)`);
    console.log(`🌐 Réseau détecté: ${addressInfo.network}`);

    // 2. Extraire la signature si elle vient d'un objet (format Xverse/OKX)
    let signatureString = signature;
    if (typeof signature === 'object' && signature.signature) {
      console.log('⚠️ Format objet détecté, extraction de la signature...');
      signatureString = signature.signature;
    }

    // 3. Vérification avec BIP-322 (supporte tous les formats)
    console.log('🔐 Vérification signature BIP-322...');
    
    // Le 4ème paramètre (false) permet d'accepter les signatures legacy aussi
    const isValid = Verifier.verifySignature(address, message, signatureString, false);

    if (isValid) {
      console.log('✅ Signature cryptographiquement valide !');
      return { 
        valid: true, 
        addressType: addressInfo.type,
        addressLabel: addressInfo.label
      };
    } else {
      console.log('❌ Signature cryptographiquement invalide');
      return { 
        valid: false, 
        error: 'Signature cryptographiquement invalide - La signature ne correspond pas à l\'adresse',
        addressType: addressInfo.type,
        addressLabel: addressInfo.label
      };
    }

  } catch (error: any) {
    console.error('❌ Erreur lors de la vérification:', error);
    
    // Gestion des erreurs spécifiques
    if (error.message?.includes('Invalid address')) {
      return { 
        valid: false, 
        error: 'Adresse Bitcoin invalide'
      };
    }
    
    if (error.message?.includes('network')) {
      return { 
        valid: false, 
        error: `Adresse incompatible avec le réseau ${network}`
      };
    }

    return { 
      valid: false, 
      error: `Erreur de vérification: ${error.message}`
    };
  }
}

// ========================================
// FONCTION PRINCIPALE
// ========================================
serve(async (req) => {
  // Gestion CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Vérifier la méthode HTTP
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ 
          valid: false,
          error: 'Méthode non autorisée (utilisez POST)' 
        }),
        { 
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Parser le body de la requête
    const { address, message, signature, network } = await req.json();

    // Validation des paramètres
    if (!address || !message || !signature) {
      return new Response(
        JSON.stringify({ 
          valid: false,
          error: 'Paramètres manquants (address, message, signature requis)'
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`📝 Vérification de signature pour: ${address.slice(0, 10)}... sur ${network || 'mainnet'}`);

    // Vérifier cryptographiquement la signature
    const verificationResult = await verifyBitcoinSignature(
      address,
      message,
      signature,
      network || 'mainnet'
    );

    if (!verificationResult.valid) {
      console.log(`❌ Vérification échouée: ${verificationResult.error}`);
      return new Response(
        JSON.stringify({ 
          valid: false,
          error: verificationResult.error || 'Signature invalide',
          addressType: verificationResult.addressType,
          addressLabel: verificationResult.addressLabel
        }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // ✅ Signature valide : enregistrer dans la base de données
    console.log('💾 Enregistrement de la signature en base...');
    
    // Préparer l'objet signature_proof au format JSONB
    const signatureProof = {
      message: message,
      signature: typeof signature === 'string' ? signature : signature.signature,
      timestamp: Date.now(),
      verified: true,
      verified_at: new Date().toISOString(),
      addressType: verificationResult.addressType,
      addressLabel: verificationResult.addressLabel
    };

    const { error: dbError } = await supabase
      .from('user_balances')
      .update({ 
        signature_proof: signatureProof,
        last_sync: new Date().toISOString()
      })
      .eq('bitcoin_address', address);

    if (dbError) {
      console.error('❌ Erreur base de données:', dbError);
      return new Response(
        JSON.stringify({ 
          valid: false,
          error: 'Erreur lors de l\'enregistrement de la signature'
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // 🎉 Succès total !
    console.log('✅ Signature vérifiée et enregistrée avec succès');
    
    return new Response(
      JSON.stringify({ 
        valid: true,
        message: 'Signature vérifiée cryptographiquement et enregistrée avec succès',
        addressType: verificationResult.addressType,
        addressLabel: verificationResult.addressLabel
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('❌ Erreur serveur:', error);
    return new Response(
      JSON.stringify({ 
        valid: false,
        error: `Erreur interne: ${error.message}`
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});