import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  assertAllowedOrigin,
  corsHeaders,
  createAccessToken,
  jsonResponse,
  randomToken,
  REFRESH_TOKEN_TTL_SECONDS,
  sessionCookie,
  sha256Hex,
  verifyAccessToken,
} from '../_shared/auth.ts';
import { safeErrorForLog, sanitizeLogText } from '../_shared/logging.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PASSWORD_PEPPER = Deno.env.get('AUTH_PASSWORD_PEPPER') || '';
const PASSWORD_ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function databaseError(stage: string, error: unknown): Error {
  const value = error as Record<string, unknown> | null;
  const message = typeof value?.message === 'string' ? value.message : 'Unknown database error';
  const code = typeof value?.code === 'string' ? value.code : null;
  const details = typeof value?.details === 'string' ? value.details : null;
  console.error('[PASSWORD-AUTH][DATABASE]', JSON.stringify({
    stage,
    code,
    message: sanitizeLogText(message),
    details: details ? sanitizeLogText(details) : null,
  }));
  return new Error(`Password database operation failed at ${stage}`);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${PASSWORD_PEPPER}\u0000${password}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must contain at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function requestIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || null;
}

async function consumeRateLimit(
  scope: string,
  maximum: number,
  windowSeconds: number,
): Promise<boolean> {
  const scopeHash = await sha256Hex(`${PASSWORD_PEPPER}\u0000${scope}`);
  const { data, error } = await supabase.rpc('consume_password_rate_limit', {
    p_scope_hash: scopeHash,
    p_max_attempts: maximum,
    p_window_seconds: windowSeconds,
    p_block_seconds: windowSeconds,
  });
  if (error) throw databaseError('rate_limit', error);
  return data === true;
}

async function createPasswordSession(req: Request, address: string) {
  const refreshToken = randomToken();
  const refreshTokenHash = await sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const { data: session, error } = await supabase
    .from('auth_sessions')
    .insert({
      bitcoin_address: address,
      refresh_token_hash: refreshTokenHash,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) || null,
      expires_at: expiresAt.toISOString(),
      authentication_method: 'password',
    })
    .select('family_id')
    .single();
  if (error) throw databaseError('create_session', error);

  return {
    refreshToken,
    accessToken: await createAccessToken(address, session.family_id, 'password'),
  };
}

async function login(req: Request, identifier: unknown, password: unknown): Promise<Response> {
  const normalizedIdentifier = typeof identifier === 'string' ? identifier.trim() : '';
  if (
    !normalizedIdentifier
    || normalizedIdentifier.length > 100
    || typeof password !== 'string'
    || password.length > MAX_PASSWORD_LENGTH
  ) {
    return jsonResponse(req, { authenticated: false, error: 'Invalid identifier or password' }, 401);
  }

  const identifierScope = `identifier:${normalizedIdentifier.toLocaleLowerCase('en-US')}`;
  const ip = requestIp(req);
  const identifierAllowed = await consumeRateLimit(identifierScope, 10, 15 * 60);
  const ipAllowed = ip ? await consumeRateLimit(`ip:${ip}`, 60, 15 * 60) : true;
  if (!identifierAllowed || !ipAllowed) {
    return jsonResponse(req, {
      authenticated: false,
      error: 'Too many attempts. Please wait 15 minutes before trying again.',
    }, 429);
  }

  const { data: credentials, error: credentialError } = await supabase.rpc(
    'get_password_login_credential',
    { p_identifier: normalizedIdentifier },
  );
  if (credentialError) throw databaseError('load_credential', credentialError);
  const credential = credentials?.[0] || null;
  const address = credential?.bitcoin_address || null;

  const salt = credential?.password_salt
    ? base64UrlToBytes(credential.password_salt)
    : new TextEncoder().encode('bitcoin-access-dummy-salt');
  const candidateHash = await derivePasswordHash(
    password,
    salt,
    credential?.iterations || PASSWORD_ITERATIONS,
  );
  const valid = Boolean(
    address
    && credential?.password_hash
    && constantTimeEqual(candidateHash, credential.password_hash),
  );

  if (!valid) {
    return jsonResponse(req, { authenticated: false, error: 'Invalid identifier or password' }, 401);
  }

  const identifierHash = await sha256Hex(`${PASSWORD_PEPPER}\u0000${identifierScope}`);
  await supabase.rpc('clear_password_rate_limit', { p_scope_hash: identifierHash });

  const session = await createPasswordSession(req, address);
  return jsonResponse(req, {
    authenticated: true,
    address,
    accessToken: session.accessToken,
  }, 200, {
    'Set-Cookie': sessionCookie(session.refreshToken),
  });
}

async function configurePassword(
  req: Request,
  action: string,
  password: unknown,
  accessToken: unknown,
): Promise<Response> {
  const passwordError = validateNewPassword(password);
  if (passwordError) return jsonResponse(req, { configured: false, error: passwordError }, 400);
  if (typeof accessToken !== 'string') {
    return jsonResponse(req, { configured: false, error: 'Wallet authentication required' }, 401);
  }

  const auth = await verifyAccessToken(accessToken, supabase);
  if (!auth.valid || !auth.address || auth.authenticationMethod !== 'wallet') {
    return jsonResponse(req, { configured: false, error: 'Wallet authentication required' }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('bitcoin_address')
    .eq('bitcoin_address', auth.address)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    return jsonResponse(req, { configured: false, error: 'Create your profile before setting a password' }, 409);
  }

  const { data: existing, error: existingError } = await supabase
    .from('auth_password_credentials')
    .select('bitcoin_address')
    .eq('bitcoin_address', auth.address)
    .maybeSingle();
  if (existingError) throw existingError;
  if (action === 'set' && existing) {
    return jsonResponse(req, { configured: false, error: 'A password is already configured' }, 409);
  }
  if (action === 'reset' && !existing) {
    return jsonResponse(req, { configured: false, error: 'No password is configured for this account' }, 409);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = new Date().toISOString();
  const passwordHash = await derivePasswordHash(password, salt);
  const { error: saveError } = await supabase
    .from('auth_password_credentials')
    .upsert({
      bitcoin_address: auth.address,
      password_hash: passwordHash,
      password_salt: bytesToBase64Url(salt),
      algorithm: 'pbkdf2-sha256',
      iterations: PASSWORD_ITERATIONS,
      updated_at: now,
      password_changed_at: now,
    }, { onConflict: 'bitcoin_address' });
  if (saveError) throw saveError;

  const { error: preferenceError } = await supabase
    .from('auth_account_preferences')
    .delete()
    .eq('bitcoin_address', auth.address);
  if (preferenceError) throw preferenceError;

  if (action === 'reset') {
    await supabase
      .from('auth_sessions')
      .update({ revoked_at: now })
      .eq('bitcoin_address', auth.address)
      .neq('family_id', auth.sessionId)
      .is('revoked_at', null);
  }

  return jsonResponse(req, { configured: true, address: auth.address });
}

async function changePassword(
  req: Request,
  currentPassword: unknown,
  password: unknown,
  accessToken: unknown,
): Promise<Response> {
  const passwordError = validateNewPassword(password);
  if (passwordError) return jsonResponse(req, { changed: false, error: passwordError }, 400);
  if (typeof currentPassword !== 'string' || currentPassword.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse(req, { changed: false, error: 'Current password is incorrect' }, 401);
  }
  if (typeof accessToken !== 'string') {
    return jsonResponse(req, { changed: false, error: 'Authentication required' }, 401);
  }

  const auth = await verifyAccessToken(accessToken, supabase);
  if (!auth.valid || !auth.address || !auth.sessionId) {
    return jsonResponse(req, { changed: false, error: 'Authentication required' }, 401);
  }

  const accountScope = `password-change:${auth.address.toLocaleLowerCase('en-US')}`;
  const ip = requestIp(req);
  const accountAllowed = await consumeRateLimit(accountScope, 5, 15 * 60);
  const ipAllowed = ip ? await consumeRateLimit(`password-change-ip:${ip}`, 30, 15 * 60) : true;
  if (!accountAllowed || !ipAllowed) {
    return jsonResponse(req, {
      changed: false,
      error: 'Too many attempts. Please wait 15 minutes before trying again.',
    }, 429);
  }

  const { data: credential, error: credentialError } = await supabase
    .from('auth_password_credentials')
    .select('password_hash, password_salt, iterations')
    .eq('bitcoin_address', auth.address)
    .maybeSingle();
  if (credentialError) throw databaseError('load_current_credential', credentialError);

  const currentSalt = credential?.password_salt
    ? base64UrlToBytes(credential.password_salt)
    : new TextEncoder().encode('bitcoin-access-dummy-salt');
  const currentHash = await derivePasswordHash(
    currentPassword,
    currentSalt,
    credential?.iterations || PASSWORD_ITERATIONS,
  );
  const currentPasswordIsValid = Boolean(
    credential?.password_hash
    && constantTimeEqual(currentHash, credential.password_hash),
  );

  if (!currentPasswordIsValid) {
    return jsonResponse(req, { changed: false, error: 'Current password is incorrect' }, 401);
  }
  if (currentPassword === password) {
    return jsonResponse(req, {
      changed: false,
      error: 'New password must be different from the current password',
    }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = new Date().toISOString();
  const passwordHash = await derivePasswordHash(password, salt);
  const { error: saveError } = await supabase
    .from('auth_password_credentials')
    .update({
      password_hash: passwordHash,
      password_salt: bytesToBase64Url(salt),
      algorithm: 'pbkdf2-sha256',
      iterations: PASSWORD_ITERATIONS,
      updated_at: now,
      password_changed_at: now,
    })
    .eq('bitcoin_address', auth.address);
  if (saveError) throw databaseError('change_password', saveError);

  const { error: revokeError } = await supabase
    .from('auth_sessions')
    .update({ revoked_at: now })
    .eq('bitcoin_address', auth.address)
    .neq('family_id', auth.sessionId)
    .is('revoked_at', null);
  if (revokeError) throw databaseError('revoke_other_sessions', revokeError);

  const accountScopeHash = await sha256Hex(`${PASSWORD_PEPPER}\u0000${accountScope}`);
  await supabase.rpc('clear_password_rate_limit', { p_scope_hash: accountScopeHash });

  return jsonResponse(req, { changed: true, address: auth.address });
}

async function skipPasswordSetup(req: Request, accessToken: unknown): Promise<Response> {
  if (typeof accessToken !== 'string') {
    return jsonResponse(req, { skipped: false, error: 'Wallet authentication required' }, 401);
  }

  const auth = await verifyAccessToken(accessToken, supabase);
  if (!auth.valid || !auth.address || auth.authenticationMethod !== 'wallet') {
    return jsonResponse(req, { skipped: false, error: 'Wallet authentication required' }, 401);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('auth_account_preferences')
    .upsert({
      bitcoin_address: auth.address,
      password_prompt_skipped_at: now,
      updated_at: now,
    }, { onConflict: 'bitcoin_address' });
  if (error) throw error;

  return jsonResponse(req, { skipped: true, address: auth.address });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
    if (!PASSWORD_PEPPER) throw new Error('Password authentication is not configured');

    const { action, identifier, currentPassword, password, accessToken } = await req.json();
    if (action === 'login') return await login(req, identifier, password);
    if (action === 'change') {
      return await changePassword(req, currentPassword, password, accessToken);
    }
    if (action === 'set' || action === 'reset') {
      return await configurePassword(req, action, password, accessToken);
    }
    if (action === 'skip') return await skipPasswordSetup(req, accessToken);
    return jsonResponse(req, { error: 'Unsupported password operation' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password operation failed';
    console.error('[PASSWORD-AUTH]', JSON.stringify({ message: safeErrorForLog(error) }));
    const status = message === 'Origin not allowed' ? 403 : 500;
    const publicMessage = status === 403 ? message : 'Password service unavailable';
    return jsonResponse(req, { authenticated: false, error: publicMessage }, status);
  }
});
