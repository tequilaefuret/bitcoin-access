import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import * as bitcoin from 'npm:bitcoinjs-lib@6.1.7';
import {
  assertAllowedOrigin,
  corsHeaders,
  jsonResponse,
  sha256Hex,
} from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function cleanMetadata(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : fallback;
}

const MAINNET_CAIP_PREFIX = 'bip122:000000000019d6689c085ae165831e93:';

function normalizeBitcoinAddress(value: unknown): string {
  if (typeof value !== 'string') return '';

  let address = value.trim();
  if (address.toLowerCase().startsWith(MAINNET_CAIP_PREFIX)) {
    address = address.slice(MAINNET_CAIP_PREFIX.length);
  } else if (/^bip122:/i.test(address)) {
    address = address.split(':').pop() || '';
  }

  if (/^bitcoin:/i.test(address)) {
    address = address.slice('bitcoin:'.length).split('?')[0];
  }

  address = address.trim();
  return /^bc1/i.test(address) ? address.toLowerCase() : address;
}

function isSupportedMainnetAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;

  try {
    const decoded = bitcoin.address.fromBase58Check(value);
    return decoded.hash.length === 20
      && [bitcoin.networks.bitcoin.pubKeyHash, bitcoin.networks.bitcoin.scriptHash]
        .includes(decoded.version);
  } catch {
    // Try SegWit decoding below.
  }

  try {
    const decoded = bitcoin.address.fromBech32(value);
    if (decoded.prefix !== bitcoin.networks.bitcoin.bech32) return false;
    if (decoded.version === 0) return [20, 32].includes(decoded.data.length);
    return decoded.version === 1 && decoded.data.length === 32;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const origin = assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

    const {
      address: suppliedAddress,
      network,
      personaId,
      methodId,
      walletName,
      purpose = 'login',
    } = await req.json();

    const address = normalizeBitcoinAddress(suppliedAddress);
    if (!address || network !== 'mainnet') {
      return jsonResponse(req, { error: 'A mainnet Bitcoin address is required' }, 400);
    }

    if (!isSupportedMainnetAddress(address)) {
      return jsonResponse(req, { error: 'Invalid Bitcoin mainnet address' }, 400);
    }

    const requestId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
    const domain = origin ? new URL(origin).hostname : 'bitcoin-access';
    const safePurpose = cleanMetadata(purpose, 'login');
    const challenge = [
      'Bitcoin Access authentication request',
      `domain: ${domain}`,
      `request_id: ${requestId}`,
      `address: ${address}`,
      `issued_at: ${issuedAt.toISOString()}`,
      `expires_at: ${expiresAt.toISOString()}`,
      `purpose: ${safePurpose}`,
    ].join('\n');
    const challengeHash = await sha256Hex(challenge);

    const { error } = await supabase.from('auth_challenges').insert({
      request_id: requestId,
      bitcoin_address: address,
      challenge_hash: challengeHash,
      domain,
      purpose: safePurpose,
      expires_at: expiresAt.toISOString(),
    });
    if (error) throw error;

    return jsonResponse(req, {
      version: 2,
      app: 'Bitcoin Access',
      domain,
      requestId,
      address,
      personaId: cleanMetadata(personaId, 'desktop_hot_wallet'),
      methodId: cleanMetadata(methodId, 'direct-signature'),
      walletName: cleanMetadata(walletName, 'unknown'),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      purpose: safePurpose,
      challenge,
      challengePreview: challenge,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create challenge';
    const status = message === 'Origin not allowed' ? 403 : 500;
    return jsonResponse(req, { error: message }, status);
  }
});
