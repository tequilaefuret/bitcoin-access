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
      const [outboundBlock, inboundBlock] = await Promise.all([
        supabase
          .from('editorial_author_preferences')
          .select('preference')
          .eq('reader_address', address)
          .eq('target_address', targetAddress)
          .eq('preference', 'block')
          .maybeSingle(),
        supabase
          .from('editorial_author_preferences')
          .select('preference')
          .eq('reader_address', targetAddress)
          .eq('target_address', address)
          .eq('preference', 'block')
          .maybeSingle(),
      ]);

      if (outboundBlock.error) throw outboundBlock.error;
      if (inboundBlock.error) throw inboundBlock.error;
      if (outboundBlock.data || inboundBlock.data) {
        return jsonResponse(req, { error: 'Interaction impossible entre ces comptes' }, 403);
      }

    } else if (action !== 'unfollow') {
      return new Response(
        JSON.stringify({ error: 'Unknown action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: lockRows, error: lockError } = await supabase.rpc('set_follow_with_lock', {
      p_follower_address: address,
      p_following_address: targetAddress,
      p_should_follow: action === 'follow',
    });
    if (lockError) {
      if (lockError.message?.includes('INSUFFICIENT_SHELLS')) {
        return jsonResponse(req, { error: 'INSUFFICIENT_SHELLS' }, 402);
      }
      throw lockError;
    } else {
      // The database transaction is authoritative for both the relationship
      // and its refundable 10-shell lock.
    }

    const { data: following } = await supabase
      .from('follows')
      .select('following_address')
      .eq('follower_address', address)
      .order('created_at', { ascending: false });

    return new Response(
      JSON.stringify({
        success: true,
        following: (following || []).map((row: any) => row.following_address),
        shells_balance: Number(lockRows?.[0]?.new_balance) || 0,
        lock_delta: Number(lockRows?.[0]?.lock_delta) || 0,
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
