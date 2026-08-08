// ========================================
// EDGE FUNCTION : social-follow
// Manage follow/unfollow and list following addresses
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  assertAllowedOrigin,
  corsHeaders as buildCorsHeaders,
  jsonResponse,
  verifyAccessToken,
} from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifyJWT(token: string): Promise<{ valid: boolean; address?: string }> {
  return verifyAccessToken(token, supabase);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
    const body = await req.json();
    const { jwt, address, targetAddress, action } = body;

    if (!jwt || !address || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const auth = await verifyJWT(jwt);
    if (!auth.valid || auth.address !== address) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'list_following') {
      const { data, error } = await supabase
        .from('follows')
        .select('following_address')
        .eq('follower_address', address)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          following: (data || []).map((row: any) => row.following_address)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!targetAddress) {
      return new Response(
        JSON.stringify({ error: 'Missing target address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (targetAddress === address) {
      return new Response(
        JSON.stringify({ error: 'You cannot follow yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'follow') {
      const { error } = await supabase
        .from('follows')
        .upsert(
          {
            follower_address: address,
            following_address: targetAddress
          },
          {
            onConflict: 'follower_address,following_address'
          }
        );

      if (error) throw error;
    } else if (action === 'unfollow') {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_address', address)
        .eq('following_address', targetAddress);

      if (error) throw error;
    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: following } = await supabase
      .from('follows')
      .select('following_address')
      .eq('follower_address', address)
      .order('created_at', { ascending: false });

    return new Response(
      JSON.stringify({
        success: true,
        following: (following || []).map((row: any) => row.following_address)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    const status = error?.message === 'Origin not allowed' ? 403 : 500;
    return jsonResponse(req, {
      error: status === 403 ? error.message : 'Unable to update follows',
    }, status);
  }
});
