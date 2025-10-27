// ========================================
// SUPABASE EDGE FUNCTION : verify-bitcoin-signature
// Fichier : supabase/functions/verify-bitcoin-signature/index.ts
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Buffer } from 'https://deno.land/std@0.168.0/node/buffer.ts';
// Import bitcoinjs-message pour la vérification cryptographique
// @ts-ignore
// import * as bitcoinMessage from 'https://esm.sh/bitcoinjs-message@2.2.0';
import bitcoinMessage from 'npm:bitcoinjs-message@2.2.0';

// ========================================
// CONFIGURATION
// ========================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Client Supabase avec clé service_role pour bypass RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========================================
// UTILITAIRES
// ========================================

/**
 * Détecte le type d'adresse Bitcoin
 */
function detectAddressType(address: string): string {
  if (address.startsWith('1')) return 'P2PKH (Legacy)';
  if (address.startsWith('3')) return 'P2SH';
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) return 'P2WPKH (SegWit)';
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 'P2TR (Taproot)';
  return 'Unknown';
}

/**
 * Vérifie si une adresse est au format Taproot
 */
function isTaprootAddress(address: string): boolean {
  return address.startsWith('bc1p') || address.startsWith('tb1p');
}

/**
 * Valide le format de la signature (Base64)
 */
function isValidSignatureFormat(signature: string): boolean {
  // Signature Bitcoin compacte = 65 bytes en Base64 = ~88 caractères
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(signature) && signature.length >= 80 && signature.length <= 100;
}

// ========================================
// VÉRIFICATION SIGNATURE
// ========================================

/**
 * Vérifie cryptographiquement une signature Bitcoin
 * Utilise bitcoinjs-message pour la vérification réelle
 */
async function verifyBitcoinSignature(
  address: string,
  message: string,
  signature: string,
  network: string
): Promise<{ valid: boolean; error?: string; addressType?: string }> {
  try {
    // 1. Détection du type d'adresse
    const addressType = detectAddressType(address);
    console.log(`🔍 Type d'adresse détecté: ${addressType} (${address.slice(0, 10)}...)`);

    // 2. Extraire la signature si elle vient d'un objet Xverse
    let signatureString = signature;
    if (typeof signature === 'object' && signature.signature) {
      console.log('⚠️ Format Xverse détecté, extraction de la signature...');
      signatureString = signature.signature;
    }

    // 3. Vérification format signature
    if (!isValidSignatureFormat(signatureString)) {
      console.log('❌ Format de signature invalide');
      return { 
        valid: false, 
        error: 'Format de signature invalide (Base64 attendu)',
        addressType 
      };
    }

    // 4. Rejet des adresses Taproot (non supportées pour message signing)
    if (isTaprootAddress(address)) {
      console.log('⚠️ Adresse Taproot détectée - Signature de message non supportée');
      return {
        valid: false,
        error: 'Les adresses Taproot (bc1p/tb1p) ne supportent pas la signature de message standard. Veuillez utiliser une adresse SegWit (bc1q) ou Legacy.',
        addressType
      };
    }

    // 5. Configuration du réseau pour bitcoinjs-message
    let networkPrefix: any;

    if (network === 'testnet4' || network === 'testnet') {
      console.log(`🔐 Vérification signature sur ${network}...`);
      // 🆕 Pour testnet, on laisse undefined (détection auto)
      networkPrefix = undefined;
    } else {
      console.log('🔐 Vérification signature sur mainnet...');
      networkPrefix = undefined; // Pour mainnet aussi (défaut bitcoin)
    }

    // 6. Conversion signature en Buffer
    const signatureBuffer = Buffer.from(signatureString, 'base64');

    // 7. Vérification - Passer SEULEMENT 3 paramètres
    const isValid = bitcoinMessage.verify(
      message,
      address,
      signatureBuffer
    );

    if (isValid) {
      console.log('✅ Signature cryptographiquement valide !');
      return { 
        valid: true, 
        addressType 
      };
    } else {
      console.log('❌ Signature cryptographiquement invalide');
      return { 
        valid: false, 
        error: 'Signature cryptographiquement invalide - La signature ne correspond pas à l\'adresse',
        addressType 
      };
    }

  } catch (error: any) {
    console.error('❌ Erreur lors de la vérification cryptographique:', error);
    
    // Gestion des erreurs spécifiques
    if (error.message?.includes('checksum')) {
      return { 
        valid: false, 
        error: 'Adresse Bitcoin invalide (erreur de checksum)'
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
          addressType: verificationResult.addressType
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
      addressType: verificationResult.addressType
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
    console.log('✅ Signature vérifiée cryptographiquement et enregistrée avec succès');
    
    return new Response(
      JSON.stringify({ 
        valid: true,
        message: 'Signature vérifiée cryptographiquement et enregistrée avec succès',
        addressType: verificationResult.addressType
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