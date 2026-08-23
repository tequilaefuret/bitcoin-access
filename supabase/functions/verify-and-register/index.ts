// ========================================
// EDGE FUNCTION : verify-and-register (BIP-322 ONLY)
// Vérifie signature Bitcoin + Crée compte + Génère JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import { Buffer } from 'node:buffer';
import { BIP322, Address, Verifier, Witness } from 'npm:bip322-js@3.0.0';
import * as bitcoin from 'npm:bitcoinjs-lib@6.1.7';
import secp256k1 from 'npm:@bitcoinerlab/secp256k1@1.2.0';
import {
  assertAllowedOrigin,
  corsHeaders,
  createAccessToken,
  jsonResponse,
  randomToken,
  REFRESH_TOKEN_TTL_SECONDS,
  sessionCookie,
  sha256Hex,
} from '../_shared/auth.ts';
import { safeErrorForLog } from '../_shared/logging.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ========================================
// TYPES
// ========================================
type AddressType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';

interface VerificationResult {
  isValid: boolean;
  addressType: AddressType;
  error?: string;
}

// ========================================
// DÉTECTION TYPE ADRESSE
// ========================================
function detectAddressType(address: string): { type: AddressType } {
  // Taproot
  if (address.startsWith('bc1p')) {
    return { type: 'p2tr' };
  }

  // SegWit Native (P2WPKH vs P2WSH)
  if (address.startsWith('bc1q')) {
    return { 
      type: address.length <= 45 ? 'p2wpkh' : 'p2wsh', 
    };
  }

  // P2SH
  if (address.startsWith('3')) {
    return { type: 'p2sh' };
  }

  // P2PKH Legacy
  if (address.startsWith('1')) {
    return { type: 'p2pkh' };
  }

  throw new Error(`Only Bitcoin mainnet addresses are supported: ${address}`);
}

// ========================================
// VÉRIFICATION SIGNATURE DE MESSAGE BIP-322 / BIP-137
// ========================================
function verifyBitcoinSignature(
  address: string, 
  message: string, 
  signature: string
): VerificationResult {
  
  if (!address || !message || !signature) {
      return {
        isValid: false,
        addressType: 'p2pkh',
        error: 'Paramètres manquants'
      };
  }

  let addressInfo: { type: AddressType };
  
  try {
    addressInfo = detectAddressType(address);
  } catch (err) {
    return {
      isValid: false,
      addressType: 'p2pkh',
      error: err instanceof Error ? err.message : 'Adresse invalide'
    };
  }

  console.log('🔍 Type adresse:', addressInfo.type);
  console.log('🔍 Réseau: mainnet');

  // Verify legacy/BIP-137 and BIP-322 simple signatures; full proofs use the PSBT path below.
  try {
    console.log('🔐 Vérification BIP-322...');
    if (signature.startsWith('ful') || signature.startsWith('pof')) {
      throw new Error('Cette variante BIP-322 complète doit être transmise par le parcours PSBT.');
    }

    // BIP-322 v1 added the `smp` prefix. Keep the unprefixed candidate for
    // pre-finalization wallets and for the rare legacy base64 value beginning with "smp".
    const candidates = signature.startsWith('smp')
      ? [signature.slice(3), signature]
      : [signature];
    const isValid = candidates.some((candidate) => {
      try {
        return Verifier.verifySignature(address, message, candidate, false);
      } catch {
        return false;
      }
    });
    
    if (isValid) {
      console.log('✅ Signature BIP-322 valide');
      return {
        isValid: true,
        addressType: addressInfo.type,
      };
    } else {
      console.log('❌ Signature BIP-322 invalide');
      return {
        isValid: false,
        addressType: addressInfo.type,
        error: 'Signature invalide'
      };
    }
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur BIP-322:', safeErrorForLog(errorMessage));
    
    return {
      isValid: false,
      addressType: addressInfo.type,
      error: `Erreur de vérification: ${errorMessage}`
    };
  }
}

function buffersEqual(left?: Uint8Array | null, right?: Uint8Array | null): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function normalizePsbtBase64(value: string): string {
  return (value || '')
    .trim()
    .replace(/^data:[^,]+,/, '')
    .replace(/\s+/g, '');
}

function verifyFinalP2wshWitness(psbt: bitcoin.Psbt, witnessScript: Buffer): boolean {
  const input = psbt.data.inputs[0];
  if (!input.finalScriptWitness) return false;

  const witness = Witness.deserialize(input.finalScriptWitness);
  if (witness.length < 3 || witness[0].length !== 0) return false;

  const scriptFromWitness = Buffer.from(witness[witness.length - 1]);
  if (!buffersEqual(scriptFromWitness, witnessScript)) return false;

  let policy: ReturnType<typeof bitcoin.payments.p2ms>;
  try {
    policy = bitcoin.payments.p2ms({ output: witnessScript, network: bitcoin.networks.bitcoin });
  } catch {
    return false;
  }

  if (!policy.m || !policy.pubkeys?.length) return false;
  const signatures = witness.slice(1, -1).map((signature) => Buffer.from(signature));
  if (signatures.length !== policy.m) return false;

  const transaction = psbt.extractTransaction(true);
  let nextPublicKey = 0;

  for (const encodedSignature of signatures) {
    let decoded: { signature: Uint8Array; hashType: number };
    try {
      decoded = bitcoin.script.signature.decode(encodedSignature);
    } catch {
      return false;
    }

    const hash = transaction.hashForWitnessV0(0, witnessScript, 0, decoded.hashType);
    let matched = false;

    while (nextPublicKey < policy.pubkeys.length) {
      const publicKey = policy.pubkeys[nextPublicKey];
      nextPublicKey += 1;

      if (secp256k1.verify(hash, publicKey, decoded.signature)) {
        matched = true;
        break;
      }
    }

    if (!matched) return false;
  }

  return true;
}

function getGenericSignedMessage(psbt: bitcoin.Psbt): Buffer | null {
  const entry = psbt.data.globalMap.unknownKeyVals?.find(({ key }) => (
    key.length === 1 && key[0] === 0x09
  ));
  return entry ? Buffer.from(entry.value) : null;
}

function verifyFinalP2pkh(
  psbt: bitcoin.Psbt,
  signerAddress: string,
  scriptPubKey: Buffer,
): boolean {
  const transaction = psbt.extractTransaction(true);
  if (transaction.ins[0].witness.length !== 0) return false;

  const chunks = bitcoin.script.decompile(transaction.ins[0].script);
  if (!chunks || chunks.length !== 2 || !Buffer.isBuffer(chunks[0]) || !Buffer.isBuffer(chunks[1])) {
    return false;
  }

  const encodedSignature = Buffer.from(chunks[0]);
  const publicKey = Buffer.from(chunks[1]);
  const derivedAddress = bitcoin.payments.p2pkh({
    pubkey: publicKey,
    network: bitcoin.networks.bitcoin,
  }).address;
  if (derivedAddress !== signerAddress) return false;

  try {
    const decoded = bitcoin.script.signature.decode(encodedSignature);
    if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL) return false;
    const hash = transaction.hashForSignature(0, scriptPubKey, decoded.hashType);
    return secp256k1.verify(hash, publicKey, decoded.signature);
  } catch {
    return false;
  }
}

function verifyFinalP2shP2wpkh(
  psbt: bitcoin.Psbt,
  signerAddress: string,
  redeemScript: Buffer,
): boolean {
  const transaction = psbt.extractTransaction(true);
  const scriptSig = bitcoin.script.decompile(transaction.ins[0].script);
  const witness = transaction.ins[0].witness;

  if (
    !scriptSig
    || scriptSig.length !== 1
    || !Buffer.isBuffer(scriptSig[0])
    || !buffersEqual(scriptSig[0], redeemScript)
    || witness.length !== 2
  ) return false;

  const encodedSignature = Buffer.from(witness[0]);
  const publicKey = Buffer.from(witness[1]);
  if (!buffersEqual(bitcoin.crypto.hash160(publicKey), redeemScript.subarray(2))) return false;

  const derivedAddress = bitcoin.payments.p2sh({
    redeem: { output: redeemScript },
    network: bitcoin.networks.bitcoin,
  }).address;
  if (derivedAddress !== signerAddress) return false;

  try {
    const decoded = bitcoin.script.signature.decode(encodedSignature);
    if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL) return false;
    const scriptCode = bitcoin.payments.p2pkh({ pubkey: publicKey }).output;
    if (!scriptCode) return false;
    const hash = transaction.hashForWitnessV0(0, scriptCode, 0, decoded.hashType);
    return secp256k1.verify(hash, publicKey, decoded.signature);
  } catch {
    return false;
  }
}

function verifyBip322Psbt(
  signerAddress: string,
  message: string,
  signedPsbtBase64: string,
  unsignedPsbtBase64?: string | null,
): VerificationResult {
  let addressInfo: { type: AddressType };
  try {
    addressInfo = detectAddressType(signerAddress);
  } catch (error) {
    return {
      isValid: false,
      addressType: 'p2pkh',
      error: error instanceof Error ? error.message : 'Adresse invalide',
    };
  }

  if (!['p2pkh', 'p2sh', 'p2wpkh', 'p2wsh'].includes(addressInfo.type)) {
    return {
      isValid: false,
      addressType: addressInfo.type,
      error: 'Ce type d’adresse n’est pas encore pris en charge par la preuve PSBT.',
    };
  }

  try {
    const scriptPubKey = Address.convertAdressToScriptPubkey(signerAddress);
    const toSpend = BIP322.buildToSpendTx(message, scriptPubKey);
    const psbt = bitcoin.Psbt.fromBase64(normalizePsbtBase64(signedPsbtBase64), {
      network: bitcoin.networks.bitcoin,
    });
    const sourcePsbt = unsignedPsbtBase64
      ? bitcoin.Psbt.fromBase64(normalizePsbtBase64(unsignedPsbtBase64), { network: bitcoin.networks.bitcoin })
      : null;

    const expectedMessage = Buffer.from(message, 'utf8');
    const signedMessage = getGenericSignedMessage(psbt);
    const sourceMessage = sourcePsbt ? getGenericSignedMessage(sourcePsbt) : null;
    if (!signedMessage && !sourceMessage) {
      throw new Error('Le champ de message BIP-322 est absent de la PSBT. Régénérez la demande de signature.');
    }
    if (
      (signedMessage && !buffersEqual(signedMessage, expectedMessage))
      || (sourceMessage && !buffersEqual(sourceMessage, expectedMessage))
    ) {
      throw new Error('Le message affiché par la PSBT ne correspond pas au challenge serveur.');
    }

    if (psbt.inputCount !== 1 || psbt.txOutputs.length !== 1) {
      throw new Error('La PSBT doit contenir exactement une entrée et une sortie virtuelles.');
    }

    const input = psbt.txInputs[0];
    const inputTxId = Buffer.from(input.hash).reverse().toString('hex');
    const output = psbt.txOutputs[0];

    if (
      psbt.version !== 0
      || psbt.locktime !== 0
      || inputTxId !== toSpend.getId()
      || input.index !== 0
      || input.sequence !== 0
      || output.value !== 0
      || !buffersEqual(output.script, Buffer.from([bitcoin.opcodes.OP_RETURN]))
    ) {
      throw new Error('La PSBT signée ne correspond pas au défi BIP-322 attendu.');
    }

    const psbtInput = psbt.data.inputs[0];
    const sourceInput = sourcePsbt?.data.inputs[0];
    if (psbtInput.witnessUtxo && (
      psbtInput.witnessUtxo.value !== 0
      || !buffersEqual(psbtInput.witnessUtxo.script, scriptPubKey)
    )) {
      throw new Error('La sortie virtuelle de la PSBT a été modifiée.');
    }
    if (sourceInput?.witnessUtxo && (
      sourceInput.witnessUtxo.value !== 0
      || !buffersEqual(sourceInput.witnessUtxo.script, scriptPubKey)
    )) {
      throw new Error('La sortie virtuelle de la demande PSBT a été modifiée.');
    }

    if (addressInfo.type === 'p2pkh') {
      const nonWitnessUtxo = psbtInput.nonWitnessUtxo || sourceInput?.nonWitnessUtxo;
      if (!nonWitnessUtxo) throw new Error('Transaction virtuelle précédente absente de la PSBT Legacy.');

      const previousTransaction = bitcoin.Transaction.fromBuffer(Buffer.from(nonWitnessUtxo));
      if (
        previousTransaction.getId() !== toSpend.getId()
        || previousTransaction.outs.length !== 1
        || previousTransaction.outs[0].value !== 0
        || !buffersEqual(previousTransaction.outs[0].script, scriptPubKey)
      ) {
        throw new Error('La transaction virtuelle Legacy ne correspond pas au challenge.');
      }

      if (!psbtInput.finalScriptSig) {
        if (!psbtInput.nonWitnessUtxo) {
          psbt.updateInput(0, { nonWitnessUtxo: Buffer.from(nonWitnessUtxo) });
        }
        const signaturesValid = psbt.validateSignaturesOfInput(
          0,
          (publicKey, hash, signature) => secp256k1.verify(hash, publicKey, signature),
        );
        if (!signaturesValid) throw new Error('Signature PSBT Legacy invalide.');
        psbt.finalizeInput(0);
      }

      if (!verifyFinalP2pkh(psbt, signerAddress, Buffer.from(scriptPubKey))) {
        throw new Error('La signature PSBT Legacy ne contrôle pas l’adresse annoncée.');
      }
    } else if (addressInfo.type === 'p2sh') {
      const redeemScript = psbtInput.redeemScript || sourceInput?.redeemScript;
      if (
        !redeemScript
        || redeemScript.length !== 22
        || redeemScript[0] !== bitcoin.opcodes.OP_0
        || redeemScript[1] !== 0x14
      ) {
        throw new Error('Seules les adresses Nested SegWit sh(wpkh(...)) sont acceptées en PSBT.');
      }

      const derivedAddress = bitcoin.payments.p2sh({
        redeem: { output: Buffer.from(redeemScript) },
        network: bitcoin.networks.bitcoin,
      }).address;
      if (derivedAddress !== signerAddress) {
        throw new Error('Le redeem script ne correspond pas à l’adresse annoncée.');
      }

      if (!psbtInput.finalScriptWitness) {
        if (!psbtInput.redeemScript) psbt.updateInput(0, { redeemScript: Buffer.from(redeemScript) });
        const signaturesValid = psbt.validateSignaturesOfInput(
          0,
          (publicKey, hash, signature) => secp256k1.verify(hash, publicKey, signature),
        );
        if (!signaturesValid) throw new Error('Signature PSBT Nested SegWit invalide.');
        psbt.finalizeInput(0);
      }

      if (!verifyFinalP2shP2wpkh(psbt, signerAddress, Buffer.from(redeemScript))) {
        throw new Error('La signature Nested SegWit ne contrôle pas l’adresse annoncée.');
      }
    } else if (addressInfo.type === 'p2wsh') {
      let witnessScript = psbtInput.witnessScript
        || sourceInput?.witnessScript
        || null;

      if (!witnessScript && psbtInput.finalScriptWitness) {
        const finalWitness = Witness.deserialize(psbtInput.finalScriptWitness);
        witnessScript = finalWitness.length > 0
          ? Buffer.from(finalWitness[finalWitness.length - 1])
          : null;
      }

      if (!witnessScript) throw new Error('Script multisig absent de la PSBT.');

      const derivedAddress = bitcoin.payments.p2wsh({
        redeem: { output: Buffer.from(witnessScript) },
        network: bitcoin.networks.bitcoin,
      }).address;
      if (derivedAddress !== signerAddress) {
        throw new Error('Le script multisig ne correspond pas à l’adresse annoncée.');
      }

      if (!psbtInput.finalScriptWitness) {
        if (!psbtInput.witnessScript) psbt.updateInput(0, { witnessScript: Buffer.from(witnessScript) });
        const signaturesValid = psbt.validateSignaturesOfInput(
          0,
          (publicKey, hash, signature) => secp256k1.verify(hash, publicKey, signature),
        );
        if (!signaturesValid) throw new Error('Une ou plusieurs signatures multisig sont invalides.');
        psbt.finalizeInput(0);
      }

      if (!verifyFinalP2wshWitness(psbt, Buffer.from(witnessScript))) {
        throw new Error('Le seuil de signatures multisig valides n’est pas atteint.');
      }
    } else {
      if (!psbtInput.finalScriptWitness) {
        const signaturesValid = psbt.validateSignaturesOfInput(
          0,
          (publicKey, hash, signature) => secp256k1.verify(hash, publicKey, signature),
        );
        if (!signaturesValid) throw new Error('Signature PSBT invalide.');
        psbt.finalizeInput(0);
      }

      const encodedWitness = BIP322.encodeWitness(psbt);
      if (!Verifier.verifySignature(signerAddress, message, encodedWitness, false)) {
        throw new Error('La signature PSBT ne contrôle pas l’adresse annoncée.');
      }
    }

    return { isValid: true, addressType: addressInfo.type };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Erreur PSBT BIP-322:', safeErrorForLog(message));
    return { isValid: false, addressType: addressInfo.type, error: message };
  }
}

// ========================================
// RÉCUPÉRATION BALANCE BITCOIN
// ========================================
async function fetchBitcoinBalance(address: string): Promise<number> {
  const apiUrl = `https://mempool.space/api/address/${address}`;

  console.log('🌐 [FETCH_BALANCE] URL:', apiUrl);

  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    if (response.status === 404) {
      console.log('⚠️ [FETCH_BALANCE] Adresse non trouvée (404)');
      return 0;
    }
    throw new Error(`Erreur API Mempool.space: ${response.status}`);
  }

  const data = await response.json();
  
  // ✅ LOGS DE DEBUG CRITIQUES
  console.log('📊 [FETCH_BALANCE] Réponse complète:', JSON.stringify(data, null, 2));
  console.log('💰 [FETCH_BALANCE] funded_txo_sum:', data.chain_stats.funded_txo_sum);
  console.log('💸 [FETCH_BALANCE] spent_txo_sum:', data.chain_stats.spent_txo_sum);
  console.log('🧮 [FETCH_BALANCE] Différence (satoshis):', data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum);
  
  const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const pendingDelta = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  // Incoming unconfirmed funds are not credited. Pending outgoing funds reduce
  // the backing immediately, before their next-block confirmation.
  const conservativeBalance = Math.max(0, confirmedBalance + Math.min(0, pendingDelta));
  const confirmedBalanceBTC = conservativeBalance / 100000000;
  
  console.log('✅ [FETCH_BALANCE] Balance finale (BTC):', confirmedBalanceBTC);
  
  return confirmedBalanceBTC;
}

// ========================================
// HANDLER PRINCIPAL
// ========================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') {
      return jsonResponse(req, { valid: false, error: 'Method not allowed' }, 405);
    }

    const {
      address,
      message,
      signature,
      network,
      methodId = null,
      authRequest = null,
      proofFormat = null,
    } = await req.json();

    if (!address || !message || !signature || !network) {
      throw new Error('Paramètres manquants');
    }
    if (network !== 'mainnet') {
      throw new Error('Seul le réseau Bitcoin mainnet est accepté.');
    }

    const requestId = authRequest?.requestId || authRequest?.request_id || null;
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Challenge serveur manquant. Veuillez relancer la connexion.');
    }

    const challengeHash = await sha256Hex(message);
    const { data: storedChallenge, error: challengeError } = await supabase
      .from('auth_challenges')
      .select('challenge_hash, expires_at, used_at')
      .eq('request_id', requestId)
      .eq('bitcoin_address', address)
      .maybeSingle();
    if (challengeError) throw challengeError;
    if (
      !storedChallenge
      || storedChallenge.challenge_hash !== challengeHash
      || storedChallenge.used_at
      || new Date(storedChallenge.expires_at).getTime() <= Date.now()
    ) {
      throw new Error('Challenge invalide, expiré ou déjà utilisé. Veuillez relancer la connexion.');
    }

    const usesPsbt = proofFormat === 'bip322-psbt';
    if (usesPsbt && !['bip322-psbt', 'multisig-psbt'].includes(methodId)) {
      throw new Error('Méthode de preuve PSBT incohérente.');
    }

    const verification = usesPsbt
      ? verifyBip322Psbt(address, message, signature, authRequest?.unsignedPsbt || null)
      : verifyBitcoinSignature(address, message, signature);
    if (!verification.isValid) {
      throw new Error(verification.error || 'Signature invalide. La preuve de propriété a échoué.');
    }

    // Complete external reads before atomically consuming the one-time proof.
    const btcBalance = await fetchBitcoinBalance(address);
    const { data: challengeConsumed, error: consumeError } = await supabase.rpc(
      'consume_auth_challenge',
      {
        p_request_id: requestId,
        p_bitcoin_address: address,
        p_challenge_hash: challengeHash,
      },
    );
    if (consumeError) throw consumeError;
    if (!challengeConsumed) {
      throw new Error('Ce challenge a déjà été utilisé. Veuillez relancer la connexion.');
    }

    const { data: existingUser } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .maybeSingle();
    const verifiedAt = new Date().toISOString();
    let userData;

    if (existingUser) {
      const oldBtc = existingUser.btc_balance || 0;
      const delta = Math.round((btcBalance - oldBtc) * 100000000);
      const newShells = Math.max(0, (existingUser.shells_balance || 0) + delta);
      const { data: updatedUser, error: updateError } = await supabase
        .from('user_balances')
        .update({
          btc_balance: btcBalance,
          shells_balance: newShells,
          ownership_verified_at: verifiedAt,
          ownership_address_type: verification.addressType,
          ownership_proof_method: methodId || proofFormat || 'bitcoin-signature',
          last_sync: verifiedAt,
        })
        .eq('bitcoin_address', address)
        .select()
        .single();
      if (updateError) throw updateError;

      if (delta !== 0) {
        await supabase.from('transactions').insert({
          bitcoin_address: address,
          amount: delta,
          type: 'sync',
          created_at: verifiedAt,
        });
      }
      userData = updatedUser;
    } else {
      const { data: newUser, error: insertError } = await supabase
        .from('user_balances')
        .insert({
          bitcoin_address: address,
          btc_balance: btcBalance,
          shells_balance: Math.round(btcBalance * 100000000),
          shells_spent_total: 0,
          ownership_verified_at: verifiedAt,
          ownership_address_type: verification.addressType,
          ownership_proof_method: methodId || proofFormat || 'bitcoin-signature',
          last_sync: verifiedAt,
          created_at: verifiedAt,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      userData = newUser;
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('bitcoin_address, display_name, bio, location, website_url, avatar_url, cover_url, avatar_pixels, cover_pixels, avatar_bytes, cover_bytes, created_at, updated_at')
      .eq('bitcoin_address', address)
      .maybeSingle();
    if (profileError && profileError.code !== 'PGRST116') throw profileError;

    const refreshToken = randomToken();
    const refreshTokenHash = await sha256Hex(refreshToken);
    const sessionExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const { data: session, error: sessionError } = await supabase
      .from('auth_sessions')
      .insert({
        bitcoin_address: address,
        refresh_token_hash: refreshTokenHash,
        user_agent: req.headers.get('user-agent')?.slice(0, 500) || null,
        expires_at: sessionExpiresAt.toISOString(),
        authentication_method: 'wallet',
      })
      .select('family_id')
      .single();
    if (sessionError) throw sessionError;

    const accessToken = await createAccessToken(address, session.family_id, 'wallet');
    const safeBalance = { ...userData };
    delete safeBalance.signature_proof;
    const safeUser = {
      ...safeBalance,
      ownership_verified: true,
      profile: profile || null,
      has_profile: Boolean(profile),
      display_name: profile?.display_name || null,
    };

    return jsonResponse(req, { valid: true, jwt: accessToken, user: safeUser }, 200, {
      'Set-Cookie': sessionCookie(refreshToken),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    console.error('❌ [VERIFY-AND-REGISTER] Erreur:', safeErrorForLog(message));
    const status = message === 'Origin not allowed' ? 403 : 400;
    return jsonResponse(req, { valid: false, error: message }, status);
  }
});
