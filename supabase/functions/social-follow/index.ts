// supabase/functions/social-like/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { messageId, bitcoinAddress, action } = await req.json();
    // action: 'like' | 'dislike' | 'remove_like' | 'remove_dislike'

    if (!messageId || !bitcoinAddress || !action) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Vérifier que le message existe
    const { data: message } = await supabase
      .from('messages')
      .select('id')
      .eq('id', messageId)
      .single();

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'like') {
      // Supprimer dislike existant
      await supabase
        .from('message_dislikes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      // Ajouter like (ou ignorer si existe)
      await supabase
        .from('message_likes')
        .insert({ message_id: messageId, bitcoin_address: bitcoinAddress })
        .onConflict('message_id, bitcoin_address')
        .ignoreDuplicates();

    } else if (action === 'dislike') {
      // Supprimer like existant
      await supabase
        .from('message_likes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      // Ajouter dislike
      await supabase
        .from('message_dislikes')
        .insert({ message_id: messageId, bitcoin_address: bitcoinAddress })
        .onConflict('message_id, bitcoin_address')
        .ignoreDuplicates();

    } else if (action === 'remove_like') {
      await supabase
        .from('message_likes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

    } else if (action === 'remove_dislike') {
      await supabase
        .from('message_dislikes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});