import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  enrichSocialMessages,
  PUBLIC_MESSAGE_SELECT,
} from '../_shared/social-messages.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { address, action = 'profile', limit = 25, offset = 0 } = await req.json();
    if (!address) {
      return new Response(JSON.stringify({ exists: false }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'messages' || action === 'useful') {
      const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 50);
      const safeOffset = Math.max(Number(offset) || 0, 0);
      let messages: any[] = [];

      if (action === 'messages') {
        const { data, error } = await supabase
          .from('messages')
          .select(PUBLIC_MESSAGE_SELECT)
          .eq('bitcoin_address', address)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(safeOffset, safeOffset + safeLimit - 1);
        if (error) throw error;
        messages = data || [];
      } else {
        const { data: votes, error: votesError } = await supabase
          .from('message_useful_votes')
          .select('message_id, created_at')
          .eq('bitcoin_address', address)
          .order('created_at', { ascending: false })
          .range(safeOffset, safeOffset + safeLimit - 1);
        if (votesError) throw votesError;
        const ids = (votes || []).map((vote: any) => vote.message_id);
        if (ids.length > 0) {
          const { data, error } = await supabase
            .from('messages')
            .select(PUBLIC_MESSAGE_SELECT)
            .in('id', ids)
            .is('deleted_at', null);
          if (error) throw error;
          const byId = new Map((data || []).map((message: any) => [message.id, message]));
          messages = ids.map((id: string) => byId.get(id)).filter(Boolean);
        }
      }

      return new Response(JSON.stringify({
        messages: await enrichSocialMessages(supabase, messages),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const [{ data: profile, error: profileError }, { data: account, error: accountError }] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('display_name, bio, created_at, updated_at')
        .eq('bitcoin_address', address)
        .maybeSingle(),
      supabase
        .from('user_balances')
        .select('created_at, ownership_verified_at')
        .eq('bitcoin_address', address)
        .maybeSingle(),
    ]);
    if (profileError || accountError) throw profileError || accountError;
    if (!profile || !account) {
      return new Response(JSON.stringify({ exists: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    return new Response(JSON.stringify({
      exists: true,
      profile: {
        display_name: profile.display_name,
        bio: profile.bio,
        created_at: profile.created_at || account.created_at,
        updated_at: profile.updated_at,
        ownership_verified: Boolean(account.ownership_verified_at),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load profile';
    return new Response(JSON.stringify({ exists: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
