// supabase/functions/social-delete/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  DeleteObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.750.0';
import {
  assertAllowedOrigin,
  corsHeaders as buildCorsHeaders,
  jsonResponse,
  verifyAccessToken,
} from '../_shared/auth.ts';
import { safeErrorForLog } from '../_shared/logging.mjs';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? '';
const r2 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
    const body = await req.json();
    const { messageId, bitcoinAddress, jwt } = body;
    
    console.log('🗑️ social-delete:', { messageId: messageId?.slice(0, 8) });

    if (!messageId || !bitcoinAddress || !jwt) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const auth = await verifyAccessToken(jwt, supabase);
    if (!auth.valid || auth.address !== bitcoinAddress) {
      return new Response(
        JSON.stringify({ error: 'Non autorisé' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The database marks the post as deleted, releases its text/photo locks,
    // and updates the balance in one transaction. R2 cleanup follows as a
    // best-effort storage operation and never controls the financial result.
    const { data, error: deleteError } = await supabase.rpc('delete_message_and_release_locks', {
      p_bitcoin_address: bitcoinAddress,
      p_message_id: messageId,
    });
    if (deleteError) {
      if (deleteError.message?.includes('Publication introuvable')) {
        return jsonResponse(req, { error: 'Message introuvable' }, 404);
      }
      console.error('❌ Erreur suppression:', safeErrorForLog(deleteError));
      throw deleteError;
    }
    const deletion = data?.[0];

    const postMediaKeys = Array.isArray(deletion?.message_media)
      ? deletion.message_media
        .map((item: { object_key?: unknown }) => item?.object_key)
        .filter((key: unknown): key is string => typeof key === 'string' && key.startsWith('posts/'))
        .slice(0, 3)
      : [];
    if (r2 && R2_BUCKET_NAME && postMediaKeys.length > 0) {
      await Promise.all(postMediaKeys.map((key: string) => (
        r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })).catch((r2Error) => {
          console.error('Post media cleanup failed:', safeErrorForLog(r2Error));
        })
      )));
    }

    console.log('✅ Message supprimé et shells libérés');
    return jsonResponse(req, {
      success: true,
      new_balance: Number(deletion?.new_balance) || 0,
      refunded_text: Number(deletion?.refunded_text) || 0,
      refunded_media: Number(deletion?.refunded_media) || 0,
      already_deleted: Boolean(deletion?.already_deleted),
      user: {
        shells_balance: Number(deletion?.new_balance) || 0,
        shells_spent_total: Number(deletion?.shells_spent_total) || 0,
      },
    });

  } catch (error: any) {
    console.error('❌ Erreur social-delete:', safeErrorForLog(error));
    const status = error?.message === 'Origin not allowed' ? 403 : 500;
    return jsonResponse(req, {
      error: status === 403 ? error.message : 'Unable to delete message',
    }, status);
  }
});
