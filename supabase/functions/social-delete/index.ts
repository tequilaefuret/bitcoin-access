// supabase/functions/social-delete/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  assertAllowedOrigin,
  corsHeaders as buildCorsHeaders,
  jsonResponse,
  verifyAccessToken,
} from '../_shared/auth.ts';
import { safeErrorForLog } from '../_shared/logging.mjs';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
    const body = await req.json();
    const { messageId, bitcoinAddress, jwt } = body;
    
    console.log('🗑️ social-delete:', { messageId: messageId?.slice(0, 8) });

    if (!messageId || !bitcoinAddress || !jwt) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const auth = await verifyAccessToken(jwt, supabase);
    if (!auth.valid || auth.address !== bitcoinAddress) {
      return new Response(
        JSON.stringify({ error: 'Non autorisé' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Vérifier que le message appartient à l'utilisateur
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('id, bitcoin_address')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      console.error('❌ Message introuvable');
      return new Response(
        JSON.stringify({ error: 'Message introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (message.bitcoin_address !== bitcoinAddress) {
      console.error('❌ Non autorisé');
      return new Response(
        JSON.stringify({ error: 'Non autorisé' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Marquer le message comme supprimé (soft delete)
    const { error: deleteError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);

    if (deleteError) {
      console.error('❌ Erreur suppression:', safeErrorForLog(deleteError));
      throw deleteError;
    }

    console.log('✅ Message marqué comme supprimé');
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Erreur social-delete:', safeErrorForLog(error));
    const status = error?.message === 'Origin not allowed' ? 403 : 500;
    return jsonResponse(req, {
      error: status === 403 ? error.message : 'Unable to delete message',
    }, status);
  }
});
