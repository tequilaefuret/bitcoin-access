import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  assertAllowedOrigin,
  clearSessionCookie,
  corsHeaders,
  createAccessToken,
  jsonResponse,
  randomToken,
  readSessionCookie,
  REFRESH_TOKEN_TTL_SECONDS,
  sessionCookie,
  sha256Hex,
} from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

    const { action = 'refresh' } = await req.json().catch(() => ({ action: 'refresh' }));
    const currentToken = readSessionCookie(req);
    if (!currentToken) {
      return jsonResponse(req, { authenticated: false }, 401, {
        'Set-Cookie': clearSessionCookie(),
      });
    }

    const currentHash = await sha256Hex(currentToken);

    if (action === 'logout') {
      const { data: currentSession } = await supabase
        .from('auth_sessions')
        .select('family_id')
        .eq('refresh_token_hash', currentHash)
        .maybeSingle();
      if (currentSession?.family_id) {
        await supabase
          .from('auth_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('family_id', currentSession.family_id)
          .is('revoked_at', null);
      }

      return jsonResponse(req, { authenticated: false }, 200, {
        'Set-Cookie': clearSessionCookie(),
      });
    }

    const { data: knownSession } = await supabase
      .from('auth_sessions')
      .select('bitcoin_address, revoked_at, replaced_by')
      .eq('refresh_token_hash', currentHash)
      .maybeSingle();

    if (knownSession?.revoked_at && knownSession.replaced_by) {
      return jsonResponse(req, { authenticated: false, retry: true }, 409);
    }
    if (!knownSession || knownSession.revoked_at) {
      return jsonResponse(req, { authenticated: false }, 401, {
        'Set-Cookie': clearSessionCookie(),
      });
    }

    const nextToken = randomToken();
    const nextHash = await sha256Hex(nextToken);
    const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const { data: rotated, error: rotateError } = await supabase.rpc('rotate_auth_session', {
      p_current_token_hash: currentHash,
      p_new_token_hash: nextHash,
      p_new_expires_at: nextExpiresAt.toISOString(),
      p_user_agent: req.headers.get('user-agent'),
    });
    if (rotateError) throw rotateError;

    const session = Array.isArray(rotated) ? rotated[0] : null;
    if (!session?.bitcoin_address || !session?.session_id) {
      return jsonResponse(req, { authenticated: false, retry: true }, 409);
    }

    const accessToken = await createAccessToken(
      session.bitcoin_address,
      session.session_id,
      session.authentication_method,
    );
    return jsonResponse(req, {
      authenticated: true,
      address: session.bitcoin_address,
      accessToken,
    }, 200, {
      'Set-Cookie': sessionCookie(nextToken),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session operation failed';
    const status = message === 'Origin not allowed' ? 403 : 500;
    return jsonResponse(req, { authenticated: false, error: message }, status);
  }
});
