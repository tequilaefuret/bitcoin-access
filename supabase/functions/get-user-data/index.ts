import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { address } = await req.json();

    if (!address) {
      return new Response(
        JSON.stringify({ exists: false, error: 'Adresse manquante' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📊 Récupération données pour:', address.slice(0, 10) + '...');

    const { data: user, error } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!user) {
      console.log('ℹ️ Utilisateur non trouvé');
      return new Response(
        JSON.stringify({ exists: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Utilisateur trouvé');

    return new Response(
      JSON.stringify({
        exists: true,
        user: {
          bitcoin_address: user.bitcoin_address,
          btc_balance: user.btc_balance,
          wbtc_balance: user.wbtc_balance,
          wbtc_spent_total: user.wbtc_spent_total,
          signature_proof: user.signature_proof,
          created_at: user.created_at,
          last_sync: user.last_sync
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Erreur:', error);
    return new Response(
      JSON.stringify({ exists: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});