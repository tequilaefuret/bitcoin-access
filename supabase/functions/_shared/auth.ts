import { create, verify } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function configuredOrigins(): Set<string> {
  const values = [
    Deno.env.get('AUTH_ALLOWED_ORIGINS') || '',
    Deno.env.get('SITE_URL') || '',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return new Set(values);
}

export function requestOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')?.replace(/\/$/, '') || null;
  if (!origin) return null;
  return configuredOrigins().has(origin) ? origin : null;
}

export function assertAllowedOrigin(req: Request): string | null {
  const suppliedOrigin = req.headers.get('origin');
  const allowedOrigin = requestOrigin(req);

  if (suppliedOrigin && !allowedOrigin) {
    throw new Error('Origin not allowed');
  }

  return allowedOrigin;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = requestOrigin(req);
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type AuthenticationMethod = 'wallet' | 'password' | 'passkey';

export async function createAccessToken(
  address: string,
  sessionId: string,
  authenticationMethod: AuthenticationMethod = 'wallet',
): Promise<string> {
  const secret = Deno.env.get('SUP_JWT_SECRET') || '';
  if (!secret) throw new Error('Missing session signing secret');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const issuedAt = Math.floor(Date.now() / 1000);

  return create(
    { alg: 'HS256', typ: 'JWT' },
    {
      address,
      session_id: sessionId,
      amr: [authenticationMethod],
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
      iss: 'bitcoin-access',
      aud: 'bitcoin-access-api',
    },
    key,
  );
}

export async function verifyAccessToken(
  token: string,
  supabase: any,
): Promise<{
  valid: boolean;
  address?: string;
  sessionId?: string;
  authenticationMethod?: AuthenticationMethod;
}> {
  try {
    const secret = Deno.env.get('SUP_JWT_SECRET') || '';
    if (!secret || !token) return { valid: false };

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    const payload = await verify(token, key);
    const address = typeof payload.address === 'string' ? payload.address : null;
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;

    if (
      !address
      || !sessionId
      || payload.iss !== 'bitcoin-access'
      || payload.aud !== 'bitcoin-access-api'
    ) {
      return { valid: false };
    }

    const { data: session, error } = await supabase
      .from('auth_sessions')
      .select('id, authentication_method')
      .eq('family_id', sessionId)
      .eq('bitcoin_address', address)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !session) return { valid: false };
    const authenticationMethod = session.authentication_method as AuthenticationMethod;
    if (!['wallet', 'password', 'passkey'].includes(authenticationMethod)) {
      return { valid: false };
    }

    return { valid: true, address, sessionId, authenticationMethod };
  } catch {
    return { valid: false };
  }
}

function cookieSettings(): { name: string; secure: boolean; sameSite: string } {
  const secure = Deno.env.get('AUTH_COOKIE_SECURE') !== 'false';
  return {
    name: secure ? '__Host-bitcoin_access_session' : 'bitcoin_access_session',
    secure,
    sameSite: Deno.env.get('AUTH_COOKIE_SAME_SITE') || (secure ? 'None' : 'Lax'),
  };
}

export function sessionCookie(token: string, maxAge = REFRESH_TOKEN_TTL_SECONDS): string {
  const settings = cookieSettings();
  const attributes = [
    `${settings.name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${settings.sameSite}`,
    `Max-Age=${maxAge}`,
  ];
  if (settings.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0);
}

export function readSessionCookie(req: Request): string | null {
  const settings = cookieSettings();
  const cookies = req.headers.get('cookie') || '';

  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== settings.name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim()) || null;
  }

  return null;
}
