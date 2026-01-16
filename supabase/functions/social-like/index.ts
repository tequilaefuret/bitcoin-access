// supabase/functions/social-like/index.ts - AVEC DÉCOMPTE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LIKE_COST = 0.00000001; // 1 satoshi

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
    const { messageId, bitcoinAddress, action } = body;
    
    console.log('🎯 social-like:', { action, messageId: messageId?.slice(0, 8), address: bitcoinAddress?.slice(0, 8) });

    if (!messageId || !bitcoinAddress || !action) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Vérifier que le message existe
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id')
      .eq('id', messageId)
      .single();

    if (msgError || !message) {
      console.error('❌ Message introuvable');
      return new Response(
        JSON.stringify({ error: 'Message introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Actions qui coûtent de l'argent (ajout de like/dislike)
    const isPaidAction = action === 'like' || action === 'dislike';
    let newBalance = null; // ← NOUVEAU : stocker le nouveau solde

    if (isPaidAction) {
      // Vérifier et déduire le solde
      const { data: user, error: balanceError } = await supabase
        .from('user_balances')
        .select('wbtc_balance, wbtc_spent_total, last_sync')
        .eq('bitcoin_address', bitcoinAddress)
        .single();

      if (balanceError || !user) {
        return new Response(
          JSON.stringify({ error: 'Utilisateur non trouvé' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (user.wbtc_balance < LIKE_COST) {
        return new Response(
          JSON.stringify({ 
            error: `Solde insuffisant. Requis: ${LIKE_COST.toFixed(8)} wBTC` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ← NOUVEAU : calculer le nouveau solde
      newBalance = user.wbtc_balance - LIKE_COST;

      // Déduire le coût
      const { error: updateError } = await supabase
        .from('user_balances')
        .update({
          wbtc_balance: newBalance,
          wbtc_spent_total: (user.wbtc_spent_total || 0) + LIKE_COST,
          last_sync: new Date().toISOString()
        })
        .eq('bitcoin_address', bitcoinAddress)
        .eq('last_sync', user.last_sync); // Lock optimiste

      if (updateError) {
        console.error('❌ Erreur déduction:', updateError.message);
        return new Response(
          JSON.stringify({ error: 'Erreur déduction solde' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Enregistrer transaction
      await supabase.from('transactions').insert({
        bitcoin_address: bitcoinAddress,
        amount: -LIKE_COST,
        type: action === 'like' ? 'social_like' : 'social_dislike',
        created_at: new Date().toISOString()
      });

      console.log(`💰 ${LIKE_COST.toFixed(8)} wBTC déduit pour ${action}`);
    }

    // Exécuter l'action sociale
    if (action === 'like') {
      // Supprimer dislike existant
      await supabase
        .from('message_dislikes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      // Ajouter like
      const { error: insertError } = await supabase
        .from('message_likes')
        .insert({ message_id: messageId, bitcoin_address: bitcoinAddress });

      if (insertError && insertError.code !== '23505') {
        throw insertError;
      }

      console.log('✅ Like ajouté');

    } else if (action === 'dislike') {
      // Supprimer like existant
      await supabase
        .from('message_likes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      // Ajouter dislike
      const { error: insertError } = await supabase
        .from('message_dislikes')
        .insert({ message_id: messageId, bitcoin_address: bitcoinAddress });

      if (insertError && insertError.code !== '23505') {
        throw insertError;
      }

      console.log('✅ Dislike ajouté');

    } else if (action === 'remove_like') {
      // Gratuit - retrait de son propre like
      const { error: deleteError } = await supabase
        .from('message_likes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      if (deleteError) throw deleteError;
      console.log('✅ Like retiré (gratuit)');

    } else if (action === 'remove_dislike') {
      // Gratuit - retrait de son propre dislike
      const { error: deleteError } = await supabase
        .from('message_dislikes')
        .delete()
        .eq('message_id', messageId)
        .eq('bitcoin_address', bitcoinAddress);

      if (deleteError) throw deleteError;
      console.log('✅ Dislike retiré (gratuit)');

    } else {
      return new Response(
        JSON.stringify({ error: 'Action inconnue' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, new_balance: newBalance }), // ← NOUVEAU : inclure le solde
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Erreur social-like:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});