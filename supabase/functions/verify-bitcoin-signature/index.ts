// ========================================
// SUPABASE EDGE FUNCTION : verify-bitcoin-signature
// Fichier : supabase/functions/verify-bitcoin-signature/index.ts
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
// VÉRIFICATION SIGNATURE
// ========================================
async function verifySignatureWithBlockCypher(
  address: string,
  message: string,
  signature: string,
  network: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Pour testnet4, on accepte la signature si elle a le bon format
    // car BlockCypher ne supporte pas testnet4
    if (network === 'testnet4' || network === 'testnet') {
      console.log('⚠️ Mode testnet4 : vérification basique de format uniquement');
      
      // Vérifier que la signature a bien le format attendu de Xverse
      if (typeof signature === 'object' && signature.signature && signature.address) {
        console.log('✅ Signature au format Xverse valide');
        return { valid: true };
      } else if (typeof signature === 'string' && signature.length > 20) {
        console.log('✅ Signature string valide');
        return { valid: true };
      } else {
        return { 
          valid: false, 
          error: 'Format de signature invalide' 
        };
      }
    }

    // Pour mainnet, utiliser BlockCypher
    const blockCypherNetwork = 'main';
    const url = `https://api.blockcypher.com/v1/btc/${blockCypherNetwork}/messages/verify`;

    console.log(`🔐 Vérification signature via BlockCypher (${blockCypherNetwork})...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: address,
        msg: message,
        sig: signature
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erreur BlockCypher:', errorText);
      return { 
        valid: false, 
        error: `Erreur API BlockCypher: ${response.status}` 
      };
    }

    const result = await response.json();
    
    if (result.verified === true) {
      console.log('✅ Signature valide !');
      return { valid: true };
    } else {
      console.log('❌ Signature invalide');
      return { 
        valid: false, 
        error: 'La signature ne correspond pas à l\'adresse' 
      };
    }

  } catch (error) {
    console.error('❌ Erreur vérification signature:', error);
    return { 
      valid: false, 
      error: `Erreur technique: ${error.message}` 
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

    console.log(`📝 Vérification pour adresse: ${address}`);

    // Vérifier la signature via BlockCypher
    const verificationResult = await verifySignatureWithBlockCypher(
      address,
      message,
      signature,
      network || 'mainnet'
    );

    if (!verificationResult.valid) {
      return new Response(
        JSON.stringify({ 
          valid: false,
          error: verificationResult.error || 'Signature invalide'
        }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // ✅ Signature valide : enregistrer dans la base de données
    console.log('💾 Enregistrement de la signature en base...');
    
    const { error: dbError } = await supabase
      .from('user_balances')
      .update({ 
        signature_proof: signature,
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
        message: 'Signature vérifiée et enregistrée avec succès'
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
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