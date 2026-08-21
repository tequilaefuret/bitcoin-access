#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadState } from './danaus-real-test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_FILE = path.join(ROOT, '.secrets', 'danaus-offline-plan.json');
const VERSION = 1;
const POST_COUNT = 250;
const COMMENT_COUNT = 350;
const USEFUL_COUNT = 600;
const FOLLOW_COUNT = 300;

const topics = [
  'la confidentialité', 'les frais du réseau', 'Lightning', 'la sauvegarde des clés',
  'la vérification personnelle', 'les nœuds à la maison', 'la transmission',
  'les portefeuilles matériels', 'la souveraineté numérique', 'les commerces',
  'le multisig', 'la pédagogie', 'la résistance à la censure', 'les interfaces simples',
  'les paiements internationaux', 'la sécurité mobile', 'la gestion des UTXO',
  'les échanges pair à pair', 'l’énergie', 'les sauvegardes distribuées',
];

const postFrames = [
  (topic) => `Quelle habitude vous a le plus aidé concernant ${topic} ?`,
  (topic) => `Je teste une routine autour de ${topic}. Documenter chaque étape reste le plus utile.`,
  (topic) => `On parle souvent de ${topic}, mais rarement des compromis concrets pour débuter.`,
  (topic) => `Avez-vous une ressource claire à recommander sur ${topic} ?`,
  (topic) => `Mon avis sur ${topic} évolue : la simplicité compte autant que la technique.`,
  (topic) => `Pour ${topic}, je préfère une méthode vérifiable et répétable.`,
  (topic) => `Retour d’expérience sur ${topic} : commencer petit aide à repérer les erreurs.`,
  (topic) => `Quel compromis vous paraît raisonnable quand on aborde ${topic} ?`,
  (topic) => `Un détail oublié à propos de ${topic} est le plan de récupération réellement testé.`,
  (topic) => `J’ai pris dix minutes pour revoir ${topic}. Vérifier vaut mieux que supposer.`,
];

const comments = [
  'Je partage ce constat, surtout sur la nécessité de tester avant d’en avoir besoin.',
  'Est-ce que tu appliquerais la même méthode avec un portefeuille mobile ?',
  'Merci pour ce retour concret, cela rend le sujet beaucoup plus accessible.',
  'Je nuancerais : la solution la plus sûre dépend aussi du niveau de la personne.',
  'Pour moi, le principal risque reste une procédure trop compliquée à reproduire.',
  'Ce point mérite un exemple pas à pas pour les personnes qui découvrent le sujet.',
  'J’ai eu une expérience proche après avoir simplifié ma sauvegarde.',
  'D’accord sur le principe, avec tout de même une vérification indépendante.',
  'Discussion pratique et sans jargon inutile : c’est exactement ce qu’il faut.',
  'Quelles limites as-tu rencontrées en situation réelle ?',
  'Je commencerais par une petite somme et une restauration complète de contrôle.',
  'Le compromis entre simplicité et sécurité mérite effectivement plus d’attention.',
];

function seededRandom(seedText) {
  let state = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicUuid(value) {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomIndex(random, length) {
  return Math.floor(random() * length);
}

function randomTime(random, startMs, endMs) {
  return new Date(startMs + Math.floor(random() * Math.max(1, endMs - startMs))).toISOString();
}

function shuffled(random, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function weightedAccount(random, rankedAccounts) {
  // A few active accounts and a long tail of occasional participants.
  const position = Math.floor((random() ** 1.8) * rankedAccounts.length);
  return rankedAccounts[Math.min(position, rankedAccounts.length - 1)];
}

function buildPlan() {
  const state = loadState();
  if (state.accounts.length !== 100 || !state.accounts.every((account) => account.registered)) {
    throw new Error('The 100-account cohort is not ready');
  }
  const stoppedAt = state.scheduler?.stoppedAt;
  if (!stoppedAt) throw new Error('Stop the live scheduler before generating the offline plan');

  const periodEndMs = new Date(stoppedAt).getTime();
  const periodStartMs = periodEndMs - (48 * 60 * 60 * 1000);
  const random = seededRandom(`${state.runId}:offline-simulation-v${VERSION}`);
  const accounts = state.accounts.map(({ index, address, displayName }) => ({ index, address, displayName }));
  const rankedAccounts = shuffled(random, accounts);
  const marker = `TEST SIMULÉ ${state.runId.replaceAll('-', '').slice(0, 5)} · 48H`;

  const posts = [];
  for (let index = 0; index < POST_COUNT; index += 1) {
    const author = weightedAccount(random, rankedAccounts);
    const topic = topics[randomIndex(random, topics.length)];
    const frame = postFrames[randomIndex(random, postFrames.length)];
    posts.push({
      id: deterministicUuid(`${state.runId}:offline:post:${index}`),
      bitcoin_address: author.address,
      content: `[${marker}] ${frame(topic)}`,
      created_at: randomTime(random, periodStartMs, periodEndMs - 120_000),
    });
  }
  posts.sort((left, right) => left.created_at.localeCompare(right.created_at));

  const generatedComments = [];
  for (let index = 0; index < COMMENT_COUNT; index += 1) {
    const parent = posts[randomIndex(random, posts.length)];
    let author = weightedAccount(random, rankedAccounts);
    while (author.address === parent.bitcoin_address) author = weightedAccount(random, rankedAccounts);
    const earliest = Math.min(periodEndMs - 1_000, new Date(parent.created_at).getTime() + 30_000);
    generatedComments.push({
      id: deterministicUuid(`${state.runId}:offline:comment:${index}`),
      bitcoin_address: author.address,
      parent_id: parent.id,
      content: `[${marker}] ${comments[randomIndex(random, comments.length)]}`,
      created_at: randomTime(random, earliest, periodEndMs),
    });
  }
  generatedComments.sort((left, right) => left.created_at.localeCompare(right.created_at));

  const allMessages = [...posts, ...generatedComments];
  const useful = [];
  const usefulPairs = new Set();
  while (useful.length < USEFUL_COUNT) {
    const message = allMessages[randomIndex(random, allMessages.length)];
    let voter = weightedAccount(random, rankedAccounts);
    if (voter.address === message.bitcoin_address) continue;
    const pair = `${message.id}:${voter.address}`;
    if (usefulPairs.has(pair)) continue;
    usefulPairs.add(pair);
    const earliest = Math.min(periodEndMs - 1_000, new Date(message.created_at).getTime() + 15_000);
    useful.push({
      id: deterministicUuid(`${state.runId}:offline:useful:${useful.length}`),
      message_id: message.id,
      bitcoin_address: voter.address,
      created_at: randomTime(random, earliest, periodEndMs),
    });
  }
  useful.sort((left, right) => left.created_at.localeCompare(right.created_at));

  const follows = [];
  const followPairs = new Set();
  while (follows.length < FOLLOW_COUNT) {
    const follower = weightedAccount(random, rankedAccounts);
    const target = rankedAccounts[randomIndex(random, rankedAccounts.length)];
    if (follower.address === target.address) continue;
    const pair = `${follower.address}:${target.address}`;
    if (followPairs.has(pair)) continue;
    followPairs.add(pair);
    follows.push({
      id: deterministicUuid(`${state.runId}:offline:follow:${follows.length}`),
      follower_address: follower.address,
      following_address: target.address,
      created_at: randomTime(random, periodStartMs, periodEndMs),
    });
  }
  follows.sort((left, right) => left.created_at.localeCompare(right.created_at));

  return {
    version: VERSION,
    runId: state.runId,
    marker,
    generatedAt: new Date().toISOString(),
    periodStart: new Date(periodStartMs).toISOString(),
    periodEnd: new Date(periodEndMs).toISOString(),
    accounts,
    posts,
    comments: generatedComments,
    useful,
    follows,
  };
}

function validatePlan(plan) {
  const errors = [];
  const addresses = new Set(plan.accounts.map((account) => account.address));
  const messages = [...plan.posts, ...plan.comments];
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const ids = new Set();

  if (plan.accounts.length !== 100 || addresses.size !== 100) errors.push('Expected 100 unique accounts');
  if (plan.posts.length !== POST_COUNT) errors.push(`Expected ${POST_COUNT} posts`);
  if (plan.comments.length !== COMMENT_COUNT) errors.push(`Expected ${COMMENT_COUNT} comments`);
  if (plan.useful.length !== USEFUL_COUNT) errors.push(`Expected ${USEFUL_COUNT} Useful signals`);
  if (plan.follows.length !== FOLLOW_COUNT) errors.push(`Expected ${FOLLOW_COUNT} follows`);

  for (const row of [...messages, ...plan.useful, ...plan.follows]) {
    if (ids.has(row.id)) errors.push(`Duplicate id ${row.id}`);
    ids.add(row.id);
    if (new Date(row.created_at) < new Date(plan.periodStart) || new Date(row.created_at) > new Date(plan.periodEnd)) {
      errors.push(`Timestamp outside period for ${row.id}`);
    }
  }
  for (const message of messages) {
    if (!addresses.has(message.bitcoin_address)) errors.push(`Unknown message author ${message.id}`);
    if (message.content.length > 1000 || !message.content.startsWith(`[${plan.marker}]`)) {
      errors.push(`Invalid content ${message.id}`);
    }
  }
  for (const comment of plan.comments) {
    const parent = messagesById.get(comment.parent_id);
    if (!parent || parent.parent_id) errors.push(`Invalid parent ${comment.id}`);
    if (parent?.bitcoin_address === comment.bitcoin_address) errors.push(`Self-comment ${comment.id}`);
    if (parent && new Date(comment.created_at) < new Date(parent.created_at)) errors.push(`Early comment ${comment.id}`);
  }
  const usefulPairs = new Set();
  for (const vote of plan.useful) {
    const message = messagesById.get(vote.message_id);
    const pair = `${vote.message_id}:${vote.bitcoin_address}`;
    if (!message || message.bitcoin_address === vote.bitcoin_address || usefulPairs.has(pair)) {
      errors.push(`Invalid Useful signal ${vote.id}`);
    }
    usefulPairs.add(pair);
  }
  const followPairs = new Set();
  for (const follow of plan.follows) {
    const pair = `${follow.follower_address}:${follow.following_address}`;
    if (!addresses.has(follow.follower_address) || !addresses.has(follow.following_address)
      || follow.follower_address === follow.following_address || followPairs.has(pair)) {
      errors.push(`Invalid follow ${follow.id}`);
    }
    followPairs.add(pair);
  }
  if (errors.length > 0) throw new Error(`Offline plan validation failed:\n${errors.slice(0, 20).join('\n')}`);
  return plan;
}

function savePlan(plan) {
  fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan), { mode: 0o600 });
  fs.chmodSync(PLAN_FILE, 0o600);
}

function loadPlan() {
  if (!fs.existsSync(PLAN_FILE)) throw new Error('Generate the offline plan first');
  return validatePlan(JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')));
}

function activitySummary(plan) {
  const activity = new Map(plan.accounts.map((account) => [account.address, {
    account: account.index, posts: 0, comments: 0, useful: 0, follows: 0,
  }]));
  for (const post of plan.posts) activity.get(post.bitcoin_address).posts += 1;
  for (const comment of plan.comments) activity.get(comment.bitcoin_address).comments += 1;
  for (const vote of plan.useful) activity.get(vote.bitcoin_address).useful += 1;
  for (const follow of plan.follows) activity.get(follow.follower_address).follows += 1;
  const rows = [...activity.values()].map((row) => ({
    ...row,
    total: row.posts + row.comments + row.useful + row.follows,
  }));
  const totals = rows.map((row) => row.total).sort((a, b) => a - b);
  return {
    version: plan.version,
    marker: plan.marker,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    accounts: plan.accounts.length,
    actions: {
      posts: plan.posts.length,
      comments: plan.comments.length,
      useful: plan.useful.length,
      follows: plan.follows.length,
      total: plan.posts.length + plan.comments.length + plan.useful.length + plan.follows.length,
    },
    activityPerAccount: {
      minimum: totals[0],
      median: totals[Math.floor(totals.length / 2)],
      maximum: totals[totals.length - 1],
      inactive: totals.filter((value) => value === 0).length,
    },
    planFile: path.relative(ROOT, PLAN_FILE),
  };
}

function jsonBlock(value) {
  return `$danaus_json$${JSON.stringify(value)}$danaus_json$::jsonb`;
}

function sqlForPlan(plan) {
  const accountsJson = plan.accounts.map((account) => ({ bitcoin_address: account.address }));
  const postsJson = plan.posts;
  const commentsJson = plan.comments;
  const usefulJson = plan.useful;
  const followsJson = plan.follows;
  const markerPrefix = `[${plan.marker}]%`.replaceAll("'", "''");
  const runLock = `danaus-offline:${plan.runId}`.replaceAll("'", "''");
  const profilePrefix = `DT_${plan.runId.replaceAll('-', '').slice(0, 5)}_%`.replaceAll("'", "''");

  return `begin;
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtextextended('${runLock}', 0));

drop table if exists pg_temp.danaus_accounts;
drop table if exists pg_temp.danaus_posts;
drop table if exists pg_temp.danaus_comments;
drop table if exists pg_temp.danaus_useful;
drop table if exists pg_temp.danaus_follows;
drop table if exists pg_temp.danaus_costs;

create temp table danaus_accounts as
select bitcoin_address
from jsonb_to_recordset(${jsonBlock(accountsJson)}) as row(bitcoin_address text);

create temp table danaus_posts as
select id, bitcoin_address, content, created_at
from jsonb_to_recordset(${jsonBlock(postsJson)})
  as row(id uuid, bitcoin_address text, content text, created_at timestamptz);

create temp table danaus_comments as
select id, bitcoin_address, parent_id, content, created_at
from jsonb_to_recordset(${jsonBlock(commentsJson)})
  as row(id uuid, bitcoin_address text, parent_id uuid, content text, created_at timestamptz);

create temp table danaus_useful as
select id, message_id, bitcoin_address, created_at
from jsonb_to_recordset(${jsonBlock(usefulJson)})
  as row(id uuid, message_id uuid, bitcoin_address text, created_at timestamptz);

create temp table danaus_follows as
select id, follower_address, following_address, created_at
from jsonb_to_recordset(${jsonBlock(followsJson)})
  as row(id uuid, follower_address text, following_address text, created_at timestamp);

create temp table danaus_costs (
  bitcoin_address text not null,
  amount numeric not null,
  transaction_type text not null,
  created_at timestamptz not null,
  refundable boolean not null default false
);

do $danaus_validate$
begin
  if (select count(*) from danaus_accounts) <> 100
    or (select count(distinct bitcoin_address) from danaus_accounts) <> 100 then
    raise exception 'La cohorte hors ligne doit contenir exactement 100 comptes uniques';
  end if;
  if exists (
    select 1 from danaus_accounts a
    left join public.user_profiles p on p.bitcoin_address = a.bitcoin_address
    left join public.user_balances b on b.bitcoin_address = a.bitcoin_address
    where p.bitcoin_address is null or b.bitcoin_address is null
      or p.display_name not like '${profilePrefix}'
  ) then
    raise exception 'Un compte de la cohorte est absent ou ne correspond pas à cette campagne';
  end if;
  if exists (
    select 1 from danaus_posts p left join danaus_accounts a using (bitcoin_address)
    where a.bitcoin_address is null
    union all
    select 1 from danaus_comments c left join danaus_accounts a using (bitcoin_address)
    where a.bitcoin_address is null
  ) then
    raise exception 'Auteur hors cohorte';
  end if;
  if exists (
    select 1 from danaus_comments c
    left join danaus_posts p on p.id = c.parent_id
    where p.id is null or p.bitcoin_address = c.bitcoin_address or c.created_at < p.created_at
  ) then
    raise exception 'Commentaire ou parent invalide';
  end if;
  if exists (
    select 1 from danaus_useful v
    join (select id, bitcoin_address from danaus_posts union all select id, bitcoin_address from danaus_comments) m
      on m.id = v.message_id
    where m.bitcoin_address = v.bitcoin_address
  ) then
    raise exception 'Signal Useful appliqué à sa propre publication';
  end if;
  if exists (select 1 from danaus_follows where follower_address = following_address) then
    raise exception 'Auto-follow interdit';
  end if;
end
$danaus_validate$;

-- Lock the 100 ledgers in deterministic order for a short, coherent import.
select b.bitcoin_address
from public.user_balances b
join danaus_accounts a using (bitcoin_address)
order by b.bitcoin_address
for update of b;

with inserted as (
  insert into public.messages (
    id, bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  )
  select
    p.id,
    p.bitcoin_address,
    p.content,
    char_length(replace(p.content, E'\\n', '')),
    char_length(replace(p.content, E'\\n', '')),
    p.created_at,
    'test'
  from danaus_posts p
  on conflict (id) do nothing
  returning bitcoin_address, cost_shells, created_at
)
insert into danaus_costs (bitcoin_address, amount, transaction_type, created_at)
select bitcoin_address, cost_shells, 'message', created_at from inserted;

with inserted as (
  insert into public.messages (
    id, bitcoin_address, content, char_count, cost_shells, created_at, parent_id, content_origin
  )
  select
    c.id,
    c.bitcoin_address,
    c.content,
    char_length(replace(c.content, E'\\n', '')),
    char_length(replace(c.content, E'\\n', '')),
    c.created_at,
    c.parent_id,
    'test'
  from danaus_comments c
  on conflict (id) do nothing
  returning bitcoin_address, cost_shells, created_at
)
insert into danaus_costs (bitcoin_address, amount, transaction_type, created_at)
select bitcoin_address, cost_shells, 'message', created_at from inserted;

with inserted as (
  insert into public.message_useful_votes (id, message_id, bitcoin_address, created_at)
  select id, message_id, bitcoin_address, created_at
  from danaus_useful
  on conflict (message_id, bitcoin_address) do nothing
  returning bitcoin_address, created_at
)
insert into danaus_costs (bitcoin_address, amount, transaction_type, created_at)
select bitcoin_address, 1, 'social_useful', created_at from inserted;

with inserted as (
  insert into public.follows (id, follower_address, following_address, created_at)
  select id, follower_address, following_address, created_at
  from danaus_follows
  on conflict (follower_address, following_address) do nothing
  returning follower_address, following_address, created_at
), locked as (
  insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
  select follower_address, 'follow', following_address, 10
  from inserted
  returning owner_address, lock_key, created_at
)
insert into danaus_costs (bitcoin_address, amount, transaction_type, created_at, refundable)
select owner_address, 10, 'follow_lock', created_at, true from locked;

do $danaus_balance_check$
begin
  if exists (
    select 1
    from public.user_balances b
    join (
      select bitcoin_address, sum(amount) as total_cost
      from danaus_costs group by bitcoin_address
    ) c using (bitcoin_address)
    where b.shells_balance < c.total_cost
  ) then
    raise exception 'Solde insuffisant pour importer la simulation';
  end if;
end
$danaus_balance_check$;

insert into public.transactions (bitcoin_address, amount, type, created_at)
select bitcoin_address, -amount, transaction_type, created_at
from danaus_costs
where amount > 0;

update public.user_balances b
set
  shells_balance = b.shells_balance - c.total_cost,
  shells_spent_total = coalesce(b.shells_spent_total, 0) + c.spent_cost,
  last_sync = now()
from (
  select bitcoin_address, sum(amount) as total_cost,
    coalesce(sum(amount) filter (where not refundable), 0) as spent_cost
  from danaus_costs
  group by bitcoin_address
) c
where b.bitcoin_address = c.bitcoin_address;

do $danaus_postcheck$
begin
  if (select count(*) from public.messages where content like '${markerPrefix}') <> ${POST_COUNT + COMMENT_COUNT} then
    raise exception 'Le nombre de messages simulés ne correspond pas au plan';
  end if;
  if (
    select count(*) from public.message_useful_votes v
    join danaus_useful s
      on s.message_id = v.message_id and s.bitcoin_address = v.bitcoin_address
  ) <> ${USEFUL_COUNT} then
    raise exception 'Le nombre de signaux Useful ne correspond pas au plan';
  end if;
  if (
    select count(*) from public.follows f
    join danaus_follows s
      on s.follower_address = f.follower_address
      and s.following_address = f.following_address
  ) <> ${FOLLOW_COUNT} then
    raise exception 'Le nombre de follows ne correspond pas au plan';
  end if;
end
$danaus_postcheck$;

commit;

select
  (select count(*) from public.messages where content like '${markerPrefix}' and parent_id is null) as posts,
  (select count(*) from public.messages where content like '${markerPrefix}' and parent_id is not null) as comments,
  (select count(*) from public.message_useful_votes v join danaus_useful s on s.message_id = v.message_id and s.bitcoin_address = v.bitcoin_address) as useful,
  (select count(*) from public.follows f join danaus_follows s on s.follower_address = f.follower_address and s.following_address = f.following_address) as follows,
  (select min(shells_balance) from public.user_balances b join danaus_accounts a using (bitcoin_address)) as minimum_shells;
`;
}

function dryRunSqlForPlan(plan) {
  const sql = sqlForPlan(plan);
  const commitMarker = '\ncommit;\n';
  const position = sql.indexOf(commitMarker);
  if (position < 0) throw new Error('Could not prepare rollback-only SQL');
  return `${sql.slice(0, position)}\nrollback;\nselect 'validated_and_rolled_back' as dry_run_status;\n`;
}

function generate() {
  const plan = validatePlan(buildPlan());
  savePlan(plan);
  process.stdout.write(`${JSON.stringify(activitySummary(plan), null, 2)}\n`);
}

const command = process.argv[2] || 'summary';
if (command === 'generate') generate();
else if (command === 'summary') process.stdout.write(`${JSON.stringify(activitySummary(loadPlan()), null, 2)}\n`);
else if (command === 'sql') process.stdout.write(sqlForPlan(loadPlan()));
else if (command === 'sql-dry-run') process.stdout.write(dryRunSqlForPlan(loadPlan()));
else throw new Error(`Unknown command: ${command}`);
