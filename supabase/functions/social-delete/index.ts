// supabase/functions/social-delete/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { messageId, bitcoinAddress } = body;
    
    console.log('🗑️ social-delete:', { messageId: messageId?.slice(0, 8), address: bitcoinAddress?.slice(0, 8) });

    if (!messageId || !bitcoinAddress) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      console.error('❌ Erreur suppression:', deleteError.message);
      throw deleteError;
    }

    console.log('✅ Message marqué comme supprimé');
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Erreur social-delete:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});