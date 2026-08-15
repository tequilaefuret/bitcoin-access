# Danaus - AI Context

This document is the compact functional and technical reference for the application.
It is meant to help an AI understand the product without reading the whole codebase.

## 1. Product Summary

Danaus is a Bitcoin social network.

Core idea:
- A user connects a Bitcoin wallet from the landing page.
- The app proves ownership of the address with a cryptographic signature.
- Once verified, the user can enter the social network.
- All interactions are paid in internal `shells`, never in real on-chain BTC.
- `shells` is an internal accounting unit, not a token and not a wallet asset.

Product rules:
- The site text is English only.
- The landing page should keep some mystery and not explain everything upfront.
- Supported wallets are limited to `Leather`, `OKX`, `Phantom`, and `Xverse`.
- The app is mainnet only.
- Access to paid and social features requires an authenticated wallet owner.

## 2. Main User Journeys

### 2.1 First connection

1. User opens the landing page.
2. User clicks `Connect wallet`.
3. Reown AppKit opens and the user selects a supported wallet.
4. The app requests a message signature.
5. Backend verifies the signature and creates or updates the balance record.
6. A revocable server session is issued in an `HttpOnly` cookie.
7. A short-lived access JWT is kept only in JavaScript memory.
8. The app fetches private user data with that access token.
9. If no profile exists yet, the app asks for a display name.
10. Once the display name is saved, the user enters the social network.

### 2.2 Reconnection

1. The app asks `auth-session` to rotate the `HttpOnly` refresh cookie.
2. It receives a short-lived access token and the authenticated address.
3. It reloads the private account from Supabase.
4. If a profile exists, the user goes directly to the social experience.
5. If no profile exists, the app sends the user to profile setup.

## 3. Navigation and UI

### Landing page

The landing page is the main entry point.

It must:
- invite the user to connect a wallet
- keep a small sense of mystery
- avoid explaining all mechanics at once
- show a compact `How it works?` disclosure only on demand

### Main surfaces

The application is organized around these visible screens:
- `connect`
- `social`
- `authorized`
- `profile`
- `profile-setup`
- `game`
- `canvas`

The old separate verification page has been removed.
Wallet connection and signature verification are now handled from the landing page.

### Discreet service navigation

The mini-game and canvas remain available but are deliberately less prominent than the social network.

The side navigation should stay:
- discreet
- icon-only or icon-first
- same icon size for every item
- visually secondary to the social feed

## 4. Profile Privacy Rules

The profile page is split between owner view and public view.

### Owner profile

The owner can see:
- the Bitcoin address
- BTC balance
- shells available
- shells spent
- signature status

The `Shells spent` card on the owner profile opens the spending history modal.

### Other users' profiles

Other users must not see:
- the address
- BTC balance
- shells available
- signature details

Other users can still see:
- display name
- follow button
- activity summary
- posts, replies, and reposts

## 5. Currency and Cost Model

The app uses `shells` as its internal currency.

Rules:
- `shells` are not on-chain.
- The app never spends real BTC for user actions.
- Wallet BTC balance is mirrored into the app balance model.
- The user consumes shells through interaction.
- Cost should not be shown inside the composer while typing.
- The composer should only show character count, not an explicit cost preview.

Common cost categories:
- reading messages
- publishing messages and comments
- likes and dislikes
- game actions
- canvas actions

The exact prices are enforced in backend functions and should be considered business logic, not UI logic.

## 6. Spending History

The `Statistics` modal no longer mirrors the profile balances.

It now shows a spending history derived from transaction and content data.

Examples of entries:
- `Message` or `Comment`
- `Like` or `Dislike`
- `Mini-game`
- `Canvas`
- `Reading`

The intent is to explain where shells were consumed, not to repeat balance cards already shown on the profile.

## 7. Global Architecture

### Frontend

Stack:
- React
- Tailwind CSS
- Reown AppKit
- Supabase JS client

Main responsibilities:
- wallet connection and session state
- signature flow
- navigation between app screens
- rendering the social feed, profile, game, canvas, history, and spending modal
- calling Supabase Edge Functions through the client helper

### Backend

Stack:
- Supabase Postgres
- Supabase Edge Functions
- Service role key used only inside Edge Functions

Main responsibilities:
- verify signature ownership
- create and rotate revocable sessions
- create and sync user balances
- persist messages, profiles, follows, likes, dislikes, and canvas pixels
- apply internal costs in `shells`
- serve user and social data

### Storage model

Two kinds of state exist:
- remote state in Supabase
- local transient state in React and browser storage

Browser storage never contains an authentication credential. Non-sensitive UI
preferences can remain in `localStorage`.

## 8. Data Model

### `user_balances`

Purpose:
- main authenticated user account record

Fields:
- `id`
- `bitcoin_address` unique
- `btc_balance`
- `shells_balance`
- `shells_spent_total`
- `created_at`
- `last_sync`
- `ownership_verified_at`
- `ownership_address_type`
- `ownership_proof_method`

Role:
- stores the current BTC balance mirrored from the wallet
- stores the internal shells balance
- stores only non-sensitive ownership verification metadata

### `user_profiles`

Purpose:
- display profile for a wallet address

Fields:
- `bitcoin_address` primary key
- `display_name`
- `bio`
- `created_at`
- `updated_at`

Constraints:
- `display_name` length between 3 and 50 after trim
- unique display name
- foreign key to `user_balances(bitcoin_address)`

### `transactions`

Purpose:
- audit log of economic actions

Fields:
- `bitcoin_address`
- `amount`
- `type`
- `game_score`
- `created_at`
- `id`

Common transaction types:
- `sync`
- `message`
- `read_messages`
- `game`
- `social_like`
- `social_dislike`
- `social_useful`
- `canvas`

### `messages`

Purpose:
- feed content, replies, reposts, and soft-deleted content

Fields:
- `bitcoin_address`
- `content`
- `char_count`
- `cost_shells`
- `id`
- `created_at`
- `parent_id`
- `repost_of`
- `deleted_at`

Notes:
- `parent_id` indicates a comment or reply
- `repost_of` indicates a repost relationship
- `deleted_at` is used for soft delete

### `message_likes`

Purpose:
- track likes per message and address

### `message_dislikes`

Purpose:
- track dislikes per message and address

Legacy note:
- dislikes are no longer exposed by the current social interface
- the first Opinion foundation uses `Useful` only

### `message_useful_votes`

Purpose:
- track whether a reader found a post or comment useful
- one vote per message and Bitcoin address
- adding a vote costs `0.00000001` shell; removing it is free

The `messages.useful_count` column is maintained by a database trigger and is used by the Classic feed's `Useful` sort.

### `opinion_topics`

Purpose:
- store curated questions for the Opinion feed
- subjects have a title, category, question, status, and editorial order
- there is no generated summary in the first version

### `opinion_topic_messages`

Purpose:
- associate selected real messages with a topic
- store an internal perspective bucket used to build a varied selection

Privacy rule:
- perspective buckets are server-only
- they must not be returned to or displayed by the frontend

### `private_topic_stances`

Purpose:
- store the authenticated reader's private position for a topic
- rows are never directly readable from the browser
- only the reader's own stance can be returned through `user-operations`

### Opinion Stage 2 private tables

- `message_embeddings`: local 384-dimension message embeddings and processing state
- `opinion_topic_embeddings`: local embeddings for active editorial topics
- `opinion_message_topic_matches`: conservative automatic matches and uncertain diagnostics
- `opinion_classifier_settings`: embedding model, minimum similarity and minimum margin

The `opinion_embeddings` PGMQ queue receives work from database triggers. A Docker worker using `intfloat/multilingual-e5-small` generates embeddings locally without a paid API. A result is public-feed eligible only when its status is `matched`; uncertain rows have no accepted `topic_id`.

### `follows`

Purpose:
- store follow relationships

Fields:
- `id`
- `created_at`
- `follower_address`
- `following_address`

### Feed « For you »

- `for_you_algorithm_settings` centralise les poids et fenêtres de classement
- `for_you_impressions` mémorise les publications réellement servies
- `for_you_feedback` conserve le signal privé `not_interested`
- `rank_for_you_feed` combine réseau suivi, similarité sémantique, engagement,
  fraîcheur, historique de service et diversité d’auteurs
- Useful, replies, reposts and legacy interaction signals use the same
  exponential decay: 100% at creation, 10% after 5 days, 1% after 10 days,
  then a 1% floor so one-month and one-year signals have equal residual weight
- active follows remain structural and do not decay while the relationship exists
- decayed engagement is normalized as `E / (max(E, decayed For-you exposures) + 20)`;
  the conservative 20-impression prior prevents tiny samples from dominating
- the validated core score keeps 92%; weak reranking adds followed-account
  social proof (3%), useful direct replies (3%), and distinct participant
  breadth (2%), all time-decayed and logarithmically saturated
- weak signals rerank only the 20 core candidates and never generate candidates
  on their own; self-actions and repeated actions by one actor do not stack
- `for-you-v1.0.0` is the first immutable algorithm release; its complete
  settings snapshot and retained SQL implementation mapping live in
  `for_you_algorithm_versions`
- pre-versioning impressions and feedback are honestly isolated under the
  non-activatable `for-you-v0.0.0` label instead of being attributed to v1
- `for_you_algorithm_activations` audits releases and rollbacks, while
  `activate_for_you_algorithm_version` atomically restores a registered snapshot
- every ranked response, paid-read snapshot, stored impression, and explicit
  negative-feedback attribution carries the algorithm version that produced it
- the service role cannot update ranking weights directly; future scoring or
  code changes require a reviewed migration and a new semantic version
- Latest and Followed use opaque `(created_at, id)` keyset cursors backed by
  partial composite indexes; legacy numeric offsets remain temporarily accepted
- For-you pagination advances through recorded served-history, and every
  frontend page is defensively deduplicated
- Classic feed tabs cache messages/cursors independently; publishing a post,
  comment, or repost patches local state instead of reloading a paid feed page
- billing snapshots retain internal page metadata so an idempotent replay keeps
  the original `has_more` value and next cursor
- feed state transitions live in the pure `classicFeedState` reducer;
  `useClassicFeed` owns requests and per-tab caches, while `ClassicFeedPanel`
  and `OpinionFeedPanel` contain presentation only
- the authenticated feed query lives in `user-operations/feed-service.ts`;
  pagination and message enrichment are shared with public profiles and history
  through `_shared` modules
- les tables et scores internes ne sont jamais lisibles directement par le navigateur

### Editorial safety

- `editorial_author_preferences` stores one private `reduce`, `mute`, or `block`
  choice per reader/author pair
- `editorial_reports` stores private idempotency receipts without a textual reason;
  only aggregate `report_count` values are maintained on posts and profiles
- `editorial_message_risk` stores an internal manipulation-risk score derived
  from short engagement bursts, new-account concentration, and repeated actions
- `reduce` lowers an author's For-you score; `mute` and bidirectional `block`
  remove direct posts and indirect reposts from feeds
- block prevents follow, reply, repost, and Useful interactions in both directions
- automatic detection downranks only and must never delete or hide content
- users can remove every author restriction under Settings → Content controls

### `canvas_pixels`

Purpose:
- store the collaborative canvas state

Fields:
- `x`, `y`
- `color`
- `bitcoin_address`
- `created_at`
- `updated_at`

## 9. Edge Functions

### `verify-and-register`

Role:
- verifies the Bitcoin signature
- consumes a server-issued challenge exactly once
- creates or updates `user_balances`
- stores only non-sensitive verification metadata
- creates a refresh session and a short-lived access JWT

Input:
- `address`
- `message`
- `signature`
- `network`

Output:
- `valid`
- `jwt`
- `user`

### `get-user-data`

Role:
- returns the authenticated user record
- joins the profile if available

Returns:
- balances
- signature proof
- profile data
- `has_profile`

### `user-operations`

Role:
- central secure router for authenticated actions

Requires:
- JWT
- address matching the JWT

Supported operations:
- `sync`
- `deduct`
- `get_history`
- `publish_message`
- `get_messages`
- `get_user_messages`
- `get_stats`
- `upsert_profile`
- `place_pixels`
- `toggle_message_useful`
- `for_you_not_interested`
- `get_opinion_topics`
- `set_private_topic_stance`

Important:
- `get_history` powers the spending history modal.
- this function is the main backend surface for economic and social mutations.
- its entrypoint handles authentication, routing and atomic billing; feed
  selection and ranking are delegated to `user-operations/feed-service.ts`.

### `social-follow`

Role:
- follow and unfollow logic

### `social-delete`

Role:
- soft delete a message if it belongs to the authenticated user

## 10. Frontend Core Files

### `src/App.js`

Role:
- main router and state coordinator
- handles session restoration
- controls the step-based UI
- opens the spending history modal
- forces profile setup for first-time authenticated users without a profile

### `src/hooks/useReownWallet.js`

Role:
- initializes the Reown AppKit singleton
- manages wallet connect and disconnect
- detects the active Bitcoin network
- extracts the Bitcoin address
- provides `signMessage`

### `src/hooks/useWalletAuthFlow.js`

Role:
- centralizes the landing-page connect flow
- coordinates wallet connection, signature, and balance verification
- keeps the old verification logic out of the UI component itself

### `src/hooks/useBitcoinBalance.js`

Role:
- fetches BTC balance
- verifies and registers the user
- synchronizes balance
- publishes messages
- loads feed and comments
- loads user messages
- loads spending history
- manages canvas and game operations
- calls social actions

### `src/supabaseClient.js`

Role:
- single client wrapper for all Supabase calls
- stores and clears JWT
- provides the main backend helper functions

Main exported helpers:
- `verifyAndRegister`
- `getUserData`
- `upsertUserProfile`
- `syncUserBalance`
- `deductGameCost`
- `publishMessage`
- `getMessages`
- `getUserMessages`
- `getUserStats`
- `getSpendingHistory`
- `getCanvasPixels`
- `placeCanvasPixels`
- `getUserPixelCount`

### `src/components/steps/*`

Important steps:
- `ConnectStep.jsx`: landing page and wallet connection
- `SocialStep.jsx`: social-screen controller, writing and interactions
- `ProfileSetupStep.jsx`: choose display name on first login
- `ProfileStep.jsx`: user profile page
- `GameStep.jsx`: paid game
- `CanvasStep.jsx`: paid canvas

### Modals

- `src/components/ui/StatsModal.jsx`: spending history modal
- `src/components/ui/HistoryModal.jsx`: message history modal

### `src/components/social/MessageCard.jsx`

Role:
- render a message in the feed
- show `@display_name` when available
- fall back to truncated Bitcoin address
- expose one `Useful` action instead of like/dislike
- truncate content after 150 characters with `See more`

### Feed-specific frontend modules

- `src/features/feed/classicFeedState.js`: pure cache and pagination transitions
- `src/features/feed/useClassicFeed.js`: requests, concurrency and per-tab cache
- `src/components/social/ClassicFeedPanel.jsx`: Classic presentation
- `src/components/social/OpinionFeedPanel.jsx`: Opinion presentation
- `src/features/social/messagePresentation.js`: shared timestamp and character rules
- `src/hooks/usePendingActivity.js`: reference-counted global async activity

## 11. Business Rules

1. Only verified wallet owners can access the authenticated social flow.
2. The display name is mandatory on the first verified login.
3. The display name must be unique.
4. The app uses `shells` as its internal cost unit.
5. Real BTC is never spent on-chain for app actions.
6. Reading the feed is billed in batches, not through a visible composer cost label.
7. The profile page must show posts, replies, and reposts.
8. Soft delete is used for user messages.
9. Sensitive profile data must remain private to the owner.
10. Followed users can be prioritized in the social experience.
11. All UI text should remain in English.
12. The social surface has separate `Classic` and `Opinion` modes.
14. Adding `Useful` costs `0.00000001` shell, removing it is free, and it is the only public evaluation signal in the first Opinion version.
15. Opinion perspective buckets are internal selection data and must not be shown to readers.
16. Private topic stances must only be returned to the authenticated owner.
17. Automatic topic grouping must require both a minimum similarity and a minimum lead over the second topic.
18. Uncertain automatic classifications must not appear in the Opinion feed.
19. Embeddings, confidence scores and candidate topics must remain server-only.
20. Editorial preferences, report receipts, risk scores and reason codes must remain server-only.
21. A user can contribute at most one report count per post or profile, with no free-form report text.
22. Automated manipulation detection may downrank content but must never delete it automatically.
23. Blocking disables interactions in both directions but does not make an otherwise public profile private.

## 12. Known Implementation Notes

### Wallet provider quirk

Reown and wallet providers may return different shapes for addresses and may reject a `getAddresses` request.
The code must tolerate that and still fall back to the main address.

### Session restoration

Session restoration depends on:
- the rotating `HttpOnly` refresh cookie
- an active server-side session family
- a short-lived access JWT held in memory
- `get-user-data`

### Profile detection

Do not rely on a single field shape.
Use:
- `has_profile`
- `profile.display_name`
- `profile_display_name`
- `display_name`

The safest rule is:
- if any of these fields is present and non-empty, the profile exists
- if all are missing or empty, the app must show `profile-setup`

### Balance sync

BTC balance is fetched from mempool.space on mainnet.

### Backend source of truth

The frontend should not write profile rows or social records directly.
All authenticated mutations should go through the relevant Edge Function.

## 13. Local Run Commands

Development:

```bash
npm start
```

If port 3000 is already used, the app may be started on another port such as 3001.

Production build:

```bash
npm run build
```

## 14. Supabase Workflow

To evolve the database safely:
- create a migration in `supabase/migrations`
- deploy the migration to the target Supabase project
- redeploy the Edge Functions if backend logic changed
- verify the app against the same project used by the environment file

## 15. What an AI Should Assume First

If you need to reason about this app, assume:
- Bitcoin wallet is the primary account anchor
- signature proof is required for authorization
- profile creation happens exactly once on first verified login
- profile display names are unique
- social interactions cost internal `shells`
- the frontend is a step-driven single-page app
- Supabase Edge Functions are the source of truth for sensitive business logic
