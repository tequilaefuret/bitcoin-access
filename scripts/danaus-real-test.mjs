#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1';

const PROJECT_REF = 'xliclljhcgddydzieolt';
const API_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const SITE_ORIGIN = 'https://danaus-dev.netlify.app';
// A Supabase publishable/anon key is intentionally public and is already
// embedded in the site's browser bundle. Private test credentials never are.
const ANON_KEY = process.env.DANAUS_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsaWNsbGpoY2dkZHlkemllb2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1ODgyNTEsImV4cCI6MjA3NTE2NDI1MX0.lacewlwJL6h9lcjtGMG2w7j9T8mn818C9ryREAc6aEw';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_DIR = path.join(ROOT, '.secrets');
const KEY_FILE = path.join(SECRET_DIR, 'danaus-real-test.key');
const STATE_FILE = path.join(SECRET_DIR, 'danaus-real-test-state.enc');
const LOG_FILE = path.join(SECRET_DIR, 'danaus-real-test-events.jsonl');
const DEFAULT_COUNT = 100;
const DEFAULT_HOURS = 48;

const adjectives = [
  'Calme', 'Libre', 'Curieux', 'Solaire', 'Nomade', 'Patient', 'Clair', 'Brave',
  'Joyeux', 'Prudent', 'Agile', 'Serein', 'Vif', 'Humble', 'Lumineux', 'Fidele',
  'Solide', 'Franc', 'Paisible', 'Malin',
];
const nouns = [
  'Satoshi', 'Mempool', 'Noeud', 'Bloc', 'Mineur', 'Eclair', 'Cypher', 'Utxo',
  'Hash', 'Wallet', 'Routier', 'Baleine', 'Renard', 'Hibou', 'Lynx', 'Castor',
  'Albatros', 'Panda', 'Corail', 'Orbite',
];

const topics = [
  'la confidentialité au quotidien', 'les frais du réseau', 'les paiements Lightning',
  'la sauvegarde des clés', 'la vérification personnelle', 'les nœuds à la maison',
  'la transmission à ses proches', 'les portefeuilles matériels', 'la souveraineté numérique',
  'l’adoption par les commerces', 'les bonnes pratiques multisig', 'la pédagogie Bitcoin',
  'la résistance à la censure', 'la simplicité des interfaces', 'les paiements internationaux',
  'la sécurité mobile', 'les sauvegardes distribuées', 'la gestion des UTXO',
  'les échanges pair à pair', 'la consommation énergétique',
];
const postFrames = [
  (topic) => `Question du jour : quelle habitude vous a le plus aidé concernant ${topic} ?`,
  (topic) => `Je teste une nouvelle routine autour de ${topic}. Le plus utile reste de documenter chaque étape simplement.`,
  (topic) => `Petite réflexion : on parle souvent de ${topic}, mais rarement des compromis concrets pour un débutant.`,
  (topic) => `Avez-vous une ressource claire à recommander sur ${topic} ? Je cherche surtout des retours pratiques.`,
  (topic) => `Mon point de vue sur ${topic} a changé récemment : la simplicité compte autant que la technique.`,
  (topic) => `Pour ${topic}, je préfère une méthode vérifiable et répétable plutôt qu’une solution magique.`,
  (topic) => `Retour d’expérience sur ${topic} : commencer petit permet de repérer les erreurs sans stress.`,
  (topic) => `Débat ouvert : quel compromis vous semble raisonnable quand on aborde ${topic} ?`,
  (topic) => `Un détail souvent oublié à propos de ${topic} est l’importance d’un plan de récupération testé.`,
  (topic) => `Aujourd’hui j’ai pris dix minutes pour revoir ${topic}. Une vérification courte vaut mieux qu’une longue supposition.`,
];
const commentFrames = [
  'Je partage ce constat, surtout sur la nécessité de tester avant d’en avoir besoin.',
  'Intéressant. Est-ce que tu appliquerais la même méthode avec un portefeuille mobile ?',
  'Merci pour ce retour concret, cela rend le sujet beaucoup plus accessible.',
  'Je nuancerais un peu : la solution la plus sûre dépend aussi du niveau de la personne.',
  'Bonne question. Pour moi, le principal risque reste une procédure trop compliquée à reproduire.',
  'Ce point mérite un exemple pas à pas, surtout pour les personnes qui découvrent le sujet.',
  'J’ai eu une expérience proche, avec de meilleurs résultats après avoir simplifié ma sauvegarde.',
  'D’accord sur le principe. Je garderais tout de même une vérification indépendante.',
  'Voilà le genre de discussion que j’aimerais voir plus souvent : pratique et sans jargon inutile.',
  'Je serais curieux de connaître les limites que tu as rencontrées en situation réelle.',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function ensureSecretStorage() {
  fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(SECRET_DIR, 0o700);
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  fs.chmodSync(KEY_FILE, 0o600);
}

function loadKey() {
  ensureSecretStorage();
  const key = fs.readFileSync(KEY_FILE);
  if (key.length !== 32) throw new Error('Invalid encrypted-state key');
  return key;
}

export function saveState(state) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(state), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = Buffer.concat([Buffer.from('DANAUS01'), iv, cipher.getAuthTag(), ciphertext]);
  const temporary = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, payload, { mode: 0o600 });
  fs.renameSync(temporary, STATE_FILE);
  fs.chmodSync(STATE_FILE, 0o600);
}

export function loadState() {
  const key = loadKey();
  if (!fs.existsSync(STATE_FILE)) {
    const state = {
      version: 1,
      runId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      siteOrigin: SITE_ORIGIN,
      projectRef: PROJECT_REF,
      accounts: [],
      messageCache: [],
      counters: {},
      scheduler: null,
    };
    saveState(state);
    return state;
  }
  const payload = fs.readFileSync(STATE_FILE);
  if (payload.subarray(0, 8).toString('utf8') !== 'DANAUS01') {
    throw new Error('Unknown encrypted-state format');
  }
  const iv = payload.subarray(8, 20);
  const tag = payload.subarray(20, 36);
  const ciphertext = payload.subarray(36);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function logEvent(type, details = {}) {
  ensureSecretStorage();
  const record = { at: new Date().toISOString(), type, ...details };
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  fs.chmodSync(LOG_FILE, 0o600);
  process.stdout.write(`${record.at} ${type}${details.index ? ` account=${details.index}` : ''}\n`);
}

function increment(state, name) {
  state.counters[name] = (state.counters[name] || 0) + 1;
}

function baseHeaders(cookie = null) {
  return {
    'Content-Type': 'application/json',
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    Origin: SITE_ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function cookieFromResponse(response, fallback = null) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()[0]
    : response.headers.get('set-cookie');
  if (!raw) return fallback;
  return raw.split(';', 1)[0] || fallback;
}

async function api(functionName, body, { cookie = null, attempts = 5 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/${functionName}`, {
        method: 'POST',
        headers: baseHeaders(cookie),
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false || data?.valid === false) {
        const error = new Error(data.error || `${functionName} returned HTTP ${response.status}`);
        error.status = response.status;
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw error;
        lastError = error;
      } else {
        return { data, cookie: cookieFromResponse(response, cookie) };
      }
    } catch (error) {
      lastError = error;
      if (error.status && ![408, 425, 429, 500, 502, 503, 504].includes(error.status)) throw error;
    }
    if (attempt < attempts) await sleep(Math.min(30_000, 750 * (2 ** (attempt - 1))) + randomInt(0, 500));
  }
  throw lastError || new Error(`${functionName} failed`);
}

function validPrivateKey() {
  while (true) {
    const candidate = crypto.randomBytes(32);
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
  }
}

function encodeVarInt(value) {
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const result = Buffer.allocUnsafe(3);
    result[0] = 0xfd;
    result.writeUInt16LE(value, 1);
    return result;
  }
  throw new Error('Unexpectedly large witness item');
}

function serializeWitness(items) {
  return Buffer.concat([
    encodeVarInt(items.length),
    ...items.flatMap((item) => [encodeVarInt(item.length), item]),
  ]);
}

export function signBip322Simple(message, privateKey, publicKey, address) {
  const tagHash = bitcoin.crypto.sha256(Buffer.from('BIP0322-signed-message', 'utf8'));
  const messageHash = bitcoin.crypto.sha256(Buffer.concat([
    tagHash,
    tagHash,
    Buffer.from(message, 'utf8'),
  ]));
  const scriptPubKey = bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);

  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(
    Buffer.alloc(32),
    0xffffffff,
    0,
    bitcoin.script.compile([bitcoin.opcodes.OP_0, messageHash]),
  );
  toSpend.addOutput(scriptPubKey, 0);

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.addInput(toSpend.getHash(), 0, 0);
  toSign.addOutput(Buffer.from([bitcoin.opcodes.OP_RETURN]), 0);

  const scriptCode = bitcoin.payments.p2pkh({ pubkey: publicKey }).output;
  const signatureHash = toSign.hashForWitnessV0(
    0,
    scriptCode,
    0,
    bitcoin.Transaction.SIGHASH_ALL,
  );
  const signature = secp256k1.sign(signatureHash, privateKey, { lowS: true, prehash: false });
  const encodedSignature = Buffer.concat([
    Buffer.from(signature.toDERRawBytes()),
    Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
  ]);
  return serializeWitness([encodedSignature, publicKey]).toString('base64');
}

function profileName(state, index) {
  const marker = state.runId.replaceAll('-', '').slice(0, 5);
  return `DT_${marker}_${adjectives[index % adjectives.length]}${nouns[(index * 7) % nouns.length]}_${String(index + 1).padStart(3, '0')}`;
}

function newAccount(state, index) {
  const privateKey = validPrivateKey();
  const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
  const payment = bitcoin.payments.p2wpkh({ pubkey: publicKey, network: bitcoin.networks.bitcoin });
  if (!payment.address) throw new Error('Unable to derive P2WPKH address');
  return {
    index: index + 1,
    address: payment.address,
    privateKey: privateKey.toString('hex'),
    publicKey: publicKey.toString('hex'),
    displayName: profileName(state, index),
    password: crypto.randomBytes(24).toString('base64url'),
    registered: false,
    profiled: false,
    passwordConfigured: false,
    cookie: null,
    accessToken: null,
    lastAuthenticatedAt: null,
  };
}

async function authenticateAccount(account) {
  const challengeResult = await api('auth-challenge', {
    address: account.address,
    network: 'mainnet',
    personaId: 'desktop_hot_wallet',
    methodId: 'manual-signature',
    walletName: 'Danaus controlled test signer',
    purpose: 'login',
  });
  const authRequest = challengeResult.data;
  const signature = signBip322Simple(
    authRequest.challenge,
    Buffer.from(account.privateKey, 'hex'),
    Buffer.from(account.publicKey, 'hex'),
    account.address,
  );
  const verified = await api('verify-and-register', {
    address: account.address,
    message: authRequest.challenge,
    signature,
    network: 'mainnet',
    personaId: 'desktop_hot_wallet',
    methodId: 'manual-signature',
    authRequest,
    proofFormat: null,
  });
  account.accessToken = verified.data.jwt;
  account.cookie = verified.cookie;
  account.registered = true;
  account.lastAuthenticatedAt = new Date().toISOString();
}

async function invokeUserOperation(account, operation, payload = {}) {
  await ensureAccessToken(account);
  return api('user-operations', {
    operation,
    jwt: account.accessToken,
    address: account.address,
    ...payload,
  });
}

function tokenExpiresSoon(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return !payload.exp || (payload.exp * 1000) <= Date.now() + 90_000;
  } catch {
    return true;
  }
}

async function ensureAccessToken(account) {
  if (!tokenExpiresSoon(account.accessToken)) return 'current';
  if (account.cookie) {
    try {
      const refreshed = await api('auth-session', { action: 'refresh' }, { cookie: account.cookie });
      if (refreshed.data.authenticated && refreshed.data.accessToken) {
        account.accessToken = refreshed.data.accessToken;
        account.cookie = refreshed.cookie;
        account.lastAuthenticatedAt = new Date().toISOString();
        return 'refresh';
      }
    } catch (error) {
      logEvent('session_refresh_failed', { index: account.index, error: error.message });
    }
  }
  await authenticateAccount(account);
  return 'wallet';
}

async function refreshCheck(requestedIndex) {
  const state = loadState();
  const account = state.accounts[requestedIndex - 1];
  if (!account) throw new Error(`Unknown account ${requestedIndex}`);
  account.accessToken = null;
  const method = await ensureAccessToken(account);
  saveState(state);
  logEvent('session_check_complete', { index: account.index, method });
  process.stdout.write(`${JSON.stringify({ success: true, account: account.index, method }, null, 2)}\n`);
}

async function completeAccount(state, account) {
  if (!account.registered || !account.accessToken) {
    await authenticateAccount(account);
    logEvent('wallet_registered', { index: account.index, address: account.address });
    saveState(state);
  }
  if (!account.profiled) {
    await invokeUserOperation(account, 'upsert_profile', {
      displayName: account.displayName,
      bio: `Compte synthétique contrôlé pour le test réel Danaus ${state.runId.slice(0, 8)}.`,
    });
    account.profiled = true;
    logEvent('profile_created', { index: account.index, displayName: account.displayName });
    saveState(state);
  }
  if (!account.passwordConfigured) {
    await api('password-auth', {
      action: 'set',
      password: account.password,
      accessToken: account.accessToken,
    });
    account.passwordConfigured = true;
    logEvent('password_configured', { index: account.index });
    saveState(state);
  }
}

async function bootstrap(count) {
  const state = loadState();
  for (let index = state.accounts.length; index < count; index += 1) {
    state.accounts.push(newAccount(state, index));
    saveState(state);
  }
  for (const account of state.accounts.slice(0, count)) {
    if (account.registered && account.profiled && account.passwordConfigured) continue;
    try {
      await completeAccount(state, account);
    } catch (error) {
      logEvent('account_bootstrap_failed', { index: account.index, error: error.message });
      saveState(state);
      throw error;
    }
    await sleep(randomInt(700, 1500));
  }
  logEvent('bootstrap_complete', { count });
  printStatus(state);
}

function rememberMessages(state, messages) {
  const byId = new Map(state.messageCache.map((message) => [message.id, message]));
  for (const message of messages || []) {
    if (!message?.id) continue;
    byId.set(message.id, {
      id: message.id,
      bitcoin_address: message.bitcoin_address,
      parent_id: message.parent_id || null,
      created_at: message.created_at || null,
    });
  }
  state.messageCache = [...byId.values()].slice(-500);
}

async function loadFeed(state, account) {
  const result = await invokeUserOperation(account, 'get_messages', {
    requestId: crypto.randomUUID(),
    limit: randomInt(8, 20),
    offset: 0,
    sortMode: pick(['recent', 'recent', 'for_you', 'followed']),
  });
  rememberMessages(state, result.data.messages || []);
  increment(state, 'feed_views');
  return result.data.messages || [];
}

function eligibleMessages(state, account, rootsOnly = false) {
  return state.messageCache.filter((message) => (
    message.bitcoin_address
    && message.bitcoin_address !== account.address
    && (!rootsOnly || !message.parent_id)
  ));
}

async function publishPost(state, account) {
  const topic = topics[(account.index + (state.counters.posts || 0)) % topics.length];
  const content = `[TEST AUTOMATISÉ] ${pick(postFrames)(topic)}`;
  const result = await invokeUserOperation(account, 'publish_message', {
    requestId: crypto.randomUUID(),
    content,
  });
  rememberMessages(state, [result.data.message]);
  increment(state, 'posts');
  logEvent('post_published', { index: account.index, messageId: result.data.message?.id });
}

async function publishComment(state, account) {
  let targets = eligibleMessages(state, account, true);
  if (targets.length === 0) {
    await loadFeed(state, account);
    targets = eligibleMessages(state, account, true);
  }
  if (targets.length === 0) return publishPost(state, account);
  const target = pick(targets);
  const content = `[TEST AUTOMATISÉ] ${pick(commentFrames)}`;
  const result = await invokeUserOperation(account, 'publish_message', {
    requestId: crypto.randomUUID(),
    content,
    parentId: target.id,
  });
  rememberMessages(state, [result.data.message]);
  increment(state, 'comments');
  logEvent('comment_published', { index: account.index, messageId: result.data.message?.id, parentId: target.id });
}

async function markUseful(state, account) {
  let targets = eligibleMessages(state, account, false);
  if (targets.length === 0) {
    await loadFeed(state, account);
    targets = eligibleMessages(state, account, false);
  }
  if (targets.length === 0) return publishPost(state, account);
  const target = pick(targets);
  await invokeUserOperation(account, 'toggle_message_useful', { messageId: target.id });
  increment(state, 'useful');
  logEvent('useful_toggled', { index: account.index, messageId: target.id });
}

async function followAccount(state, account) {
  const targets = state.accounts.filter((candidate) => candidate.address !== account.address && candidate.profiled);
  if (targets.length === 0) return;
  const target = pick(targets);
  await ensureAccessToken(account);
  await api('social-follow', {
    jwt: account.accessToken,
    address: account.address,
    targetAddress: target.address,
    action: 'follow',
  });
  increment(state, 'follows');
  logEvent('account_followed', { index: account.index, targetIndex: target.index });
}

async function performAction(state, account) {
  const roll = randomInt(1, 100);
  if (roll <= 24) return publishPost(state, account);
  if (roll <= 50) return publishComment(state, account);
  if (roll <= 72) return markUseful(state, account);
  if (roll <= 90) return followAccount(state, account);
  await loadFeed(state, account);
  logEvent('feed_loaded', { index: account.index });
}

async function smokeTest() {
  const state = loadState();
  const [author, commenter, voter, follower] = state.accounts;
  if (![author, commenter, voter, follower].every((account) => account?.passwordConfigured)) {
    throw new Error('Four ready accounts are required for the smoke test');
  }

  await loadFeed(state, author);
  const post = await invokeUserOperation(author, 'publish_message', {
    requestId: crypto.randomUUID(),
    content: '[TEST AUTOMATISÉ] Message de contrôle : publication, commentaire, Useful et follow de bout en bout.',
  });
  const message = post.data.message;
  if (!message?.id) throw new Error('Smoke-test post did not return an id');
  rememberMessages(state, [message]);
  increment(state, 'posts');
  logEvent('smoke_post_published', { index: author.index, messageId: message.id });

  await invokeUserOperation(commenter, 'publish_message', {
    requestId: crypto.randomUUID(),
    content: '[TEST AUTOMATISÉ] Commentaire de contrôle reçu et publié correctement.',
    parentId: message.id,
  });
  increment(state, 'comments');
  logEvent('smoke_comment_published', { index: commenter.index, parentId: message.id });

  await invokeUserOperation(voter, 'toggle_message_useful', { messageId: message.id });
  increment(state, 'useful');
  logEvent('smoke_useful_added', { index: voter.index, messageId: message.id });

  await ensureAccessToken(follower);
  await api('social-follow', {
    jwt: follower.accessToken,
    address: follower.address,
    targetAddress: author.address,
    action: 'follow',
  });
  increment(state, 'follows');
  logEvent('smoke_follow_added', { index: follower.index, targetIndex: author.index });

  saveState(state);
  logEvent('smoke_complete', { messageId: message.id });
  printStatus(state);
}

async function runScheduler(hours) {
  const state = loadState();
  const ready = state.accounts.filter((account) => account.registered && account.profiled && account.passwordConfigured);
  if (ready.length !== DEFAULT_COUNT) {
    throw new Error(`Expected ${DEFAULT_COUNT} ready accounts, found ${ready.length}`);
  }
  const now = Date.now();
  if (!state.scheduler?.endsAt || new Date(state.scheduler.endsAt).getTime() <= now) {
    state.scheduler = {
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + hours * 60 * 60 * 1000).toISOString(),
      status: 'running',
    };
  } else {
    state.scheduler.status = 'running';
  }
  saveState(state);
  logEvent('scheduler_started', { endsAt: state.scheduler.endsAt });

  while (Date.now() < new Date(state.scheduler.endsAt).getTime()) {
    const account = pick(ready);
    const sessionActions = randomInt(1, 4);
    try {
      await loadFeed(state, account);
      logEvent('session_started', { index: account.index, plannedActions: sessionActions });
      for (let index = 0; index < sessionActions; index += 1) {
        await performAction(state, account);
        saveState(state);
        if (index + 1 < sessionActions) await sleep(randomInt(8_000, 35_000));
      }
    } catch (error) {
      increment(state, 'errors');
      logEvent('session_error', { index: account.index, error: error.message });
      saveState(state);
    }
    const remaining = new Date(state.scheduler.endsAt).getTime() - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(remaining, randomInt(120_000, 480_000)));
  }
  state.scheduler.status = 'complete';
  state.scheduler.completedAt = new Date().toISOString();
  saveState(state);
  logEvent('scheduler_complete', { counters: state.counters });
  printStatus(state);
}

function printStatus(state) {
  const ready = state.accounts.filter((account) => account.registered && account.profiled && account.passwordConfigured);
  const summary = {
    runId: state.runId,
    accountsGenerated: state.accounts.length,
    accountsReady: ready.length,
    addressType: 'P2WPKH mainnet',
    scheduler: state.scheduler,
    counters: state.counters,
    stateEncrypted: true,
    stateFile: path.relative(ROOT, STATE_FILE),
    logFile: path.relative(ROOT, LOG_FILE),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function printBalanceSql(state) {
  const addresses = state.accounts
    .filter((account) => account.registered)
    .map((account) => `'${account.address.replaceAll("'", "''")}'`)
    .join(',\n    ');
  process.stdout.write(`update public.user_balances\nset shells_balance = greatest(shells_balance, 0.01), last_sync = now()\nwhere bitcoin_address in (\n    ${addresses}\n);\n\nselect count(*) as credited_accounts, min(shells_balance) as minimum_shells\nfrom public.user_balances\nwhere bitcoin_address in (\n    ${addresses}\n);\n`);
}

function stopScheduler() {
  const state = loadState();
  state.scheduler = {
    ...(state.scheduler || {}),
    status: 'stopped',
    stoppedAt: new Date().toISOString(),
  };
  saveState(state);
  logEvent('scheduler_stopped', { counters: state.counters });
  printStatus(state);
}

function proveOwnership(state, requestedIndex) {
  const account = state.accounts[requestedIndex - 1];
  if (!account) throw new Error(`Unknown account ${requestedIndex}`);
  const message = `Danaus controlled test ownership proof\nrun_id: ${state.runId}\naccount: ${account.index}\ntimestamp: ${new Date().toISOString()}`;
  const signature = signBip322Simple(
    message,
    Buffer.from(account.privateKey, 'hex'),
    Buffer.from(account.publicKey, 'hex'),
    account.address,
  );
  process.stdout.write(`${JSON.stringify({ address: account.address, message, signature, format: 'BIP-322 simple' }, null, 2)}\n`);
}

function numericOption(name, fallback) {
  const position = process.argv.indexOf(name);
  if (position < 0) return fallback;
  const value = Number(process.argv[position + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'pilot') return bootstrap(1);
  if (command === 'bootstrap') return bootstrap(numericOption('--count', DEFAULT_COUNT));
  if (command === 'smoke') return smokeTest();
  if (command === 'run') return runScheduler(numericOption('--hours', DEFAULT_HOURS));
  if (command === 'status') return printStatus(loadState());
  if (command === 'refresh-check') return refreshCheck(numericOption('--account', 1));
  if (command === 'stop') return stopScheduler();
  if (command === 'balance-sql') return printBalanceSql(loadState());
  if (command === 'prove') return proveOwnership(loadState(), numericOption('--account', 1));
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Danaus real test failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
