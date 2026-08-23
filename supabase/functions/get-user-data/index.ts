import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import { corsHeaders, jsonResponse, verifyAccessToken } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const { address, jwt } = await req.json();
    if (!address || !jwt) return jsonResponse(req, { exists: false, error: 'Unauthorized' }, 401);

    const auth = await verifyAccessToken(jwt, supabase);
    if (!auth.valid || auth.address !== address) {
      return jsonResponse(req, { exists: false, error: 'Unauthorized' }, 401);
    }

    const { data: user, error } = await supabase
      .from('user_balances')
      .select(`
        bitcoin_address,
        btc_balance,
        shells_balance,
        shells_spent_total,
        created_at,
        last_sync,
        ownership_verified_at,
        ownership_address_type,
        ownership_proof_method
      `)
      .eq('bitcoin_address', address)
      .maybeSingle();
    if (error) throw error;
    if (!user) return jsonResponse(req, { exists: false });

    const [
      { data: profile, error: profileError },
      { count: followersCount, error: followersError },
      { count: followingCount, error: followingError },
      { count: postsCount, error: postsError },
      { count: repliesCount, error: repliesError },
      { count: repostsCount, error: repostsError },
      { count: usefulCount, error: usefulError },
    ] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('bitcoin_address, display_name, bio, location, website_url, avatar_url, cover_url, avatar_pixels, cover_pixels, avatar_bytes, cover_bytes, created_at, updated_at')
        .eq('bitcoin_address', address)
        .maybeSingle(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_address', address),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_address', address),
      supabase.from('messages').select('*', { count: 'exact', head: true })
        .eq('bitcoin_address', address).is('parent_id', null).is('repost_of', null).is('deleted_at', null),
      supabase.from('messages').select('*', { count: 'exact', head: true })
        .eq('bitcoin_address', address).not('parent_id', 'is', null).is('deleted_at', null),
      supabase.from('messages').select('*', { count: 'exact', head: true })
        .eq('bitcoin_address', address).not('repost_of', 'is', null).is('deleted_at', null),
      supabase.from('message_useful_votes').select('*', { count: 'exact', head: true })
        .eq('bitcoin_address', address),
    ]);
    if (profileError || followersError || followingError
      || postsError || repliesError || repostsError || usefulError) {
      throw profileError || followersError || followingError
        || postsError || repliesError || repostsError || usefulError;
    }

    const { data: passwordCredential, error: passwordError } = await supabase
      .from('auth_password_credentials')
      .select('bitcoin_address')
      .eq('bitcoin_address', address)
      .maybeSingle();
    if (passwordError) throw passwordError;

    const { data: accountPreferences, error: preferencesError } = await supabase
      .from('auth_account_preferences')
      .select('password_prompt_skipped_at')
      .eq('bitcoin_address', address)
      .maybeSingle();
    if (preferencesError) throw preferencesError;

    return jsonResponse(req, {
      exists: true,
      user: {
        ...user,
        ownership_verified: Boolean(user.ownership_verified_at),
        profile: profile || null,
        has_profile: Boolean(profile),
        password_configured: Boolean(passwordCredential),
        password_setup_skipped: Boolean(accountPreferences?.password_prompt_skipped_at),
        followers_count: followersCount || 0,
        following_count: followingCount || 0,
        profile_counts: {
          posts: postsCount || 0,
          replies: repliesCount || 0,
          reposts: repostsCount || 0,
          useful: usefulCount || 0,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load account';
    return jsonResponse(req, { exists: false, error: message }, 500);
  }
});
