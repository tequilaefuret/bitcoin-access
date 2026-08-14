# Authentication security

## Resulting model

Bitcoin signatures are account bootstrap and recovery proofs. They are not
browser sessions and are never returned by an API.

Once ownership has been proved, a password can be attached to the account. A
returning user can then sign in with either the public Bitcoin address or the
display name. The password never replaces the wallet for account creation or
password recovery.

The authentication flow is now:

1. The browser requests a challenge from `auth-challenge`.
2. The server creates the exact message, stores only its SHA-256 hash and gives
   it a ten-minute lifetime.
3. The wallet signs that exact message.
4. `verify-and-register` verifies the signature and atomically consumes the
   challenge. A second use is rejected.
5. The server stores only verification metadata on `user_balances`.
6. A revocable, rotating refresh session is stored as a hash in
   `auth_sessions`.
7. The raw refresh token is sent only as an `HttpOnly` cookie.
8. A fifteen-minute access token stays in JavaScript memory and is never saved
   in `localStorage`.
9. A first verified connection requires a unique display name and recommends an
   optional password. The user can keep wallet-only authentication.
10. The password is derived with PBKDF2-SHA-256, 600,000 iterations, a unique
    random salt and a secret server-side pepper.
11. Password login creates the same rotating `HttpOnly` session as wallet login.
12. A forgotten password can only be replaced after a new wallet proof.
13. An authenticated user can change the password from Settings only after the
    current password has been verified; other session families are then revoked.

Disconnecting a wallet does not disconnect the Bitcoin Access account. The
`Log out` action revokes every refresh session in the current session family.

## Database deployment

The migrations `202608070001_authentication_hardening.sql`,
`202608070002_password_authentication.sql`,
`202608070003_optional_password_setup.sql`,
`202608070004_social_reposts_and_followed_feed.sql` and
`202608070005_password_login_reliability.sql`:

- purges stored messages, signatures, PSBTs and authentication payloads;
- adds non-sensitive ownership verification columns;
- creates `auth_challenges` and `auth_sessions`;
- enables RLS and revokes browser access to both tables;
- creates the atomic challenge-consumption and session-rotation functions.
- stores password derivatives in a private table that browser roles cannot read;
- rate-limits attempts without exposing whether a username exists;
- records whether each session originated from a wallet, password or passkey.
- privately remembers when an account chooses wallet-only authentication.
- adds simple reposts and quoted posts while keeping the original publication linked;
- resolves password credentials by address or display name in one private database call.

For the linked Supabase environment, preview and then apply migrations:

```bash
supabase db push --dry-run
supabase db push
```

Run this independently for development and production. Confirm the project ref
shown by the CLI before accepting the production migration.

## Required Edge Function secrets

### Password pepper

Generate the password pepper once per Supabase environment, then store it as an
Edge Function secret. This is required in development as well as production:

```bash
AUTH_PASSWORD_PEPPER_VALUE="$(openssl rand -hex 32)"
supabase secrets set AUTH_PASSWORD_PEPPER="$AUTH_PASSWORD_PEPPER_VALUE"
unset AUTH_PASSWORD_PEPPER_VALUE
```

Do not put this value in `.env.local`, in a `REACT_APP_*` variable, or in Git.
Use a different value for development and production. Do not rotate or delete
it after users have created passwords: existing passwords would stop working
and users would need to reset them with their wallets.

### Local React development

No `AUTH_ALLOWED_ORIGINS` configuration is required for the usual local React
server. The authentication functions already allow both development origins:

```text
http://127.0.0.1:3000
http://localhost:3000
```

The project command `npm start` uses `http://127.0.0.1:3000`, so it is already
covered. Keep using the Supabase URL from `.env.local` and do not replace it
with a public website domain.

In development, authentication requests automatically use the local
`/api/auth` proxy from `src/setupProxy.js`. The refresh cookie is therefore
same-origin and is not blocked as a third-party Supabase cookie. Do not define
`REACT_APP_AUTH_API_URL` in `.env.local`: that would bypass the local proxy.

Configure the linked **development** Supabase project for its HTTP local
frontend:

```bash
supabase secrets set AUTH_COOKIE_SECURE=false AUTH_COOKIE_SAME_SITE=Lax
```

Do not apply `AUTH_COOKIE_SECURE=false` to production. Production must use a
secure HTTPS cookie.

After adding or changing `src/setupProxy.js`, stop the existing React process
with `Ctrl+C` and restart it:

```bash
npm start
```

The first connection after enabling the proxy requires one normal wallet or
password authentication. Subsequent page reloads use the new local cookie and
open the feed automatically.

Set `AUTH_ALLOWED_ORIGINS` for development only if the frontend uses another
origin, for example another port or a temporary tunnel URL. The value must
contain the complete origin: protocol, host and port when one is present.

Examples:

```text
http://localhost:5173
https://temporary-test-domain.example
```

### Online deployment

Replace the example domain with the exact HTTPS origin serving the React app:

```bash
supabase secrets set \
  AUTH_ALLOWED_ORIGINS=https://YOUR_SITE_DOMAIN \
  AUTH_COOKIE_SECURE=true \
  AUTH_COOKIE_SAME_SITE=None
```

Several origins can be comma-separated. Do not use `*` because credentialed
requests must be restricted to known sites.

Deploy every function that participates in authentication or consumes an
access token:

```bash
supabase functions deploy auth-challenge
supabase functions deploy auth-session
supabase functions deploy password-auth
supabase functions deploy verify-and-register
supabase functions deploy get-user-data
supabase functions deploy get-public-profile
supabase functions deploy user-operations
supabase functions deploy social-follow
supabase functions deploy social-delete
```

Old custom JWTs are rejected by the new code because they do not contain a
valid server session family. Rotating the signing secret remains recommended
as an additional invalidation measure:

```bash
openssl rand -hex 32
supabase secrets set SUP_JWT_SECRET=PASTE_THE_GENERATED_VALUE
```

The secret must be changed only after all token-consuming functions above have
been deployed.

## Frontend deployment

The frontend accepts this variable:

```bash
REACT_APP_AUTH_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

This direct configuration uses a secure cross-site cookie. Browser privacy
settings can block cross-site cookies. For reliable automatic reconnection,
the production host should expose a same-origin reverse proxy such as:

```text
https://YOUR_SITE_DOMAIN/api/auth-session
    -> https://YOUR_PROJECT_REF.supabase.co/functions/v1/auth-session
```

The proxy must forward `POST`, `OPTIONS`, request headers, response headers and
especially every `Set-Cookie` header without caching. With a generic `/api/*`
proxy, configure:

```bash
REACT_APP_AUTH_API_URL=https://YOUR_SITE_DOMAIN/api
```

When the proxy is same-origin, set the cookie policy to `Lax`:

```bash
supabase secrets set AUTH_COOKIE_SAME_SITE=Lax
```

The exact proxy configuration depends on the hosting provider. Do not switch
the frontend variable until every configured authentication path is reachable
through the proxy.

## Verification checklist

1. A first wallet signature creates a session and opens the account.
2. Reloading the same browser restores the account without opening the wallet.
3. Disconnecting Reown or the wallet application leaves the site session open.
4. Clicking `Log out` prevents automatic restoration.
5. Reusing the same signed challenge is rejected.
6. `get-user-data` rejects an address without a valid access token.
7. `get-public-profile` returns no balance, signature, PSBT or session data.
8. Neither `btc_auth_token` nor `bitcoin_address` exists in `localStorage`.
9. A verified account without a password sees the optional password recommendation once.
10. The user can subsequently sign in with either display name or Bitcoin address.
11. An incorrect password returns the same error for known and unknown accounts.
12. `Forgot password` requires a new wallet proof before accepting a replacement.
13. Replacing a password revokes the account's other active session families.
14. Settings requires the correct current password before accepting a new one.
15. Selecting `Continue with wallet only` opens the site and is remembered.
16. A wallet-only user can add a password later from the personal profile or Settings.
17. Signing in with either the exact address or the display name opens the same account.
18. A duplicate display name displays `Ce pseudo est déjà pris` instead of a generic Edge Function error.
19. A simple repost appears in `Latest`, in `Followed` for followers and in the author's `Reposts` profile tab.
20. A quoted post displays the author's text and an embedded copy of the original post.
21. The `Followed` feed contains only publications from accounts followed by the current user.
22. Publications marked Useful appear in the profile's `Useful` tab.

## Social feed deployment

The social changes require both the database migration and updated Edge
Functions. Apply them in this order:

```bash
supabase db push --dry-run
supabase db push
supabase functions deploy auth-challenge
supabase functions deploy password-auth
supabase functions deploy user-operations
supabase functions deploy get-public-profile
supabase functions deploy social-follow
```

The first `supabase db push` after the latest corrections must show
`202608070006_fix_password_rate_limit_timestamp.sql` and
`202608070007_charge_reposted_characters.sql`. If one is absent, stop before
deploying and check that the CLI is linked to the intended development project.

After deployment, refresh the React page completely. Existing publications do
not need to be recreated: old rows with a `repost_of` value are classified as a
simple repost when their content is empty, otherwise as a quoted post.

A new simple repost costs one satoshi-equivalent shell per character in the
original post. A quoted repost costs the original post characters plus the
characters in the added quotation. Removing an existing simple repost does not
refund its publication cost.

## Hardware and multisig PSBT journey

1. In the hardware-wallet companion or multisig coordinator, export the public
   output descriptor. Never export a seed, private key or private descriptor.
2. In Bitcoin Access, select `Hardware` or `Multisig`, import the descriptor,
   and select the receive/change branch and address index.
3. Compare the derived address with the address displayed by the wallet. A
   descriptor checksum is verified automatically when the export contains one.
4. Create the BIP-322 PSBT authentication request.
5. Use one of the three transports shown by the interface:
   - direct PSBT signature through a compatible connected wallet;
   - animated `crypto-psbt` BC-UR QR exchange with an offline signer;
   - `.psbt` file export and import as the universal fallback.
6. For multisig, repeat the signing transfer until the descriptor threshold is
   reached. Existing partial signatures are preserved.
7. Return the signed PSBT and select `Verify and sign in` before the ten-minute
   challenge expires.

Supported descriptor policies are deliberately restricted to mainnet public
`pkh(...)`, `wpkh(...)`, `sh(wpkh(...))`, `wsh(multi(...))` and
`wsh(sortedmulti(...))`. These cover Legacy single-signature, Native and Nested
SegWit single-signature, and Native SegWit multisig. Private extended keys are
rejected in the browser. Descriptor contents, derivation paths, redeem scripts,
witness scripts and PSBTs are public wallet metadata, but they are not stored
as account credentials.

Every generated PSBT contains the finalized BIP-322
`PSBT_GLOBAL_GENERIC_SIGNED_MESSAGE` field (`0x09`) with the exact UTF-8 server
challenge. The server reconstructs the virtual transaction from the stored
challenge and verifies this field, the previous transaction or redeem/witness
script, the final signature, and the claimed address. Animated QR transport
uses BC-UR `crypto-psbt`; it does not change or reinterpret the PSBT payload.

Direct message verification accepts both the current `smp`-prefixed BIP-322
simple format and the older unprefixed representation still returned by many
wallets. Taproot remains available through direct BIP-322 message signing. A
Taproot PSBT/`tr(...)` descriptor path is not yet enabled.

### Direct Ledger USB beta

The Hardware screen also provides a direct Ledger path for standard mainnet
Native SegWit accounts. It uses Ledger's current Device Management Kit, WebHID
transport and Bitcoin signer kit rather than the deprecated LedgerJS packages.

Requirements:

1. Use Chrome, Edge, Brave or another desktop Chromium browser with WebHID.
2. Serve the site over HTTPS. `http://localhost` and `http://127.0.0.1` are also
   accepted as secure development contexts.
3. Connect and unlock the Ledger. The site never asks for the seed phrase.
4. Select the Ledger account number, receive/change branch and address index.
5. Approve opening the Bitcoin app when the Ledger asks.
6. Compare and approve the address shown on the Ledger screen. Do not approve
   if it differs from the address displayed by Bitcoin Access.
7. Create the signing request, reconnect the same Ledger and approve the proof.
8. Select `Verify and sign in` after the signed PSBT is returned.

The implementation reads only the master fingerprint and account xpub, creates
the public `wpkh(...)` descriptor locally, and verifies that local derivation
matches the address returned with `checkOnDevice: true`. Before signing, it
rejects every PSBT that does not have exactly one zero-value input for that
address, one zero-value `OP_RETURN` output, the exact server challenge in the
BIP-322 global message field, and the expected BIP32 derivation path. The
Ledger session is disconnected and the Device Management Kit is closed after
each attempt, including failures.

This path intentionally excludes Legacy, Nested SegWit, Taproot and multisig
Ledger accounts for now. Those wallets remain supported through public
descriptor import plus QR or PSBT file. The direct path stays labelled beta
until a real Ledger running the target Bitcoin app version has completed the
full BIP-322 flow; automated browser tests cannot emulate the secure device.

### Direct Trezor USB beta

The Hardware screen provides a separate direct path based on the official
`@trezor/connect-web` SDK. Trezor Connect owns the device transport and its
trusted connection window: compatible Chromium browsers can use WebUSB, while
Firefox requires Trezor Bridge. Safari is not supported by this path.

User journey:

1. Open `Hardware`, connect and unlock the Trezor, and close Trezor Suite if it
   currently owns the device connection.
2. Keep the default account `0`, `Receive` chain and index `0` unless the target
   address uses another standard Native SegWit path.
3. Select `Connect Trezor and sign in` and allow the official Trezor window.
4. Compare and approve the `bc1q...` address shown on the Trezor screen.
5. Read and approve the Bitcoin Access sign-in message. Never approve a
   transaction: this flow requests message signing only.
6. The site verifies the signature with the server challenge and opens the
   existing account or registration journey.

The implementation restricts direct Trezor authentication to standard mainnet
Native SegWit paths `m/84'/0'/account'/branch/index`. It rejects invalid path
components, non-P2WPKH addresses, a signature returned for another address and
non-compact signature payloads. It never calls Trezor transaction composition,
transaction signing, broadcasting, seed export or private-key APIs. Challenges
remain server-generated, short-lived and single-use.

Local development on `localhost` needs no Trezor configuration. Before an
online DEV or production build, define the public GitHub environment variable
`REACT_APP_TREZOR_MANIFEST_EMAIL` with a valid contact address. Trezor Connect
also receives `window.location.origin` as the manifest application URL. The
button remains disabled online if the contact is missing or invalid.

Legacy, Nested SegWit, Taproot, multisig and non-standard Trezor paths remain
available through the descriptor, message, QR and PSBT-file fallbacks. The
direct path remains labelled beta until the full journey has been tested on a
physical supported Trezor; automated tests cannot emulate its secure screen.

### Direct Jade USB and air-gapped QR beta

The Hardware screen provides two Jade-specific paths based on public protocols
implemented by the Jade firmware. Neither path opens or pairs with the
Blockstream mobile application.

The direct USB path uses Web Serial at 115200 baud and Jade's CBOR RPC methods:

1. `get_version_info` confirms that the selected serial device speaks the Jade
   protocol.
2. If the device is locked, `auth_user` asks the user for the PIN only on Jade.
   The browser relays the already encrypted blind-oracle payload directly to an
   official Jade PIN-server HTTPS origin. Cookies, referrers and credentials are
   omitted. Arbitrary or private-network URLs and custom PIN servers are not
   relayed by this site.
3. `get_receive_address` derives and displays a standard mainnet Native SegWit
   address at `m/84'/0'/account'/branch/index`. The user must confirm it on
   Jade before the server challenge is created.
4. `sign_message` displays and signs only the short-lived authentication
   challenge. The serial port and all reader/writer locks are released after
   success, cancellation or failure.

The implementation bounds account, branch and index values, CBOR nesting and
message sizes, serial buffers, HTTP response sizes, relay iterations and all
interaction timeouts. Replies must carry the expected request identifier.
Only a canonical 65-byte recoverable message signature is accepted and it is
normalized to the Native SegWit BIP-137 header before server verification.

The air-gapped path first scans the animated `crypto-account` BC-UR exported by
Jade Plus from **Options → Wallet → Export Xpub**. It accepts exactly one public
Bitcoin mainnet Native SegWit singlesig account rooted at
`m/84'/0'/account'`; private keys, other networks, scripts and paths are
rejected. The site appends the public receive/change derivation, derives the
selected address locally and never asks the user to type that address.

The site then builds the firmware's native Specter-compatible payload,
`signmessage <BIP84 path> ascii:<server challenge>`, and wraps its bytes in an
animated `UR:BYTES` sequence. Jade assembles the low-density frames, displays
the path and message, and returns a plain Base64 signature QR. The site scans
and validates that response; it does not create a PSBT. Verification is bound
to the address derived from the scanned account xpub and the selected path.

Web Serial requires HTTPS or localhost and a compatible browser. The mobile
Blockstream app owns its own USB-C session and cannot expose that session to a
separate browser tab; installing the app therefore does not enable the site's
USB button. Mobile users should use Jade QR, while direct USB is offered on a
compatible desktop Chromium browser. If Jade cannot unlock in the current
Blockstream app, update both the app and Jade firmware before diagnosing the
site connection. The interface never requests the PIN, recovery phrase,
SeedQR, private descriptor or private key. Both paths remain beta until tested
through unlock, address confirmation, signing, cancellation and timeout on
physical Jade devices and firmware versions used by the project.

Challenge address validation decodes Base58, SegWit v0 Bech32 and Taproot v1
Bech32m directly. It deliberately avoids `bitcoinjs-lib`'s
`address.toOutputScript()` shortcut because Taproot script construction requires
an initialized ECC backend even when the function only needs to validate an
address.

## Password user journeys

### First connection

1. Prove ownership with the wallet using any supported proof method.
2. Choose a unique display name if the account has no profile yet.
3. Create and confirm a password of at least 12 characters, or select
   `Continue with wallet only`.
4. Access the site. The current browser remains connected through its secure
   session cookie.

If the password is skipped, future authentication remains available through
the Bitcoin ownership proof. The user can add a password later from the
personal profile.

### Returning connection

1. The browser first tries to restore its secure session automatically.
2. If no session is available, enter the display name or public Bitcoin address.
3. Enter the password. No wallet interaction is required.

### Change an existing password

1. Open the `Private session` menu, then select `Settings`.
2. Enter the current password, the new password and its confirmation.
3. Select `Update password`.
4. The current browser stays connected and other active session families are
   revoked. The old password can no longer be used for a new connection.

### Forgotten password

1. Select `Forgot password` on the sign-in form.
2. Connect the wallet and complete a fresh ownership proof.
3. Choose a replacement password.
4. Other active sessions are revoked as a precaution.
