# Bitcoin Access

Bitcoin Access is a Bitcoin-gated social network.

Core principle:
- a user connects a wallet
- the app proves ownership by cryptographic signature
- access to the feed and social actions is then unlocked
- all app actions are charged in internal `shells`, never in real on-chain BTC

## Documentation

The main functional and technical reference is:

- [AI Context](docs/AI_CONTEXT.md)
- [Automated DEV → production deployments](docs/DEPLOYMENT_PIPELINE.md)
- [Opinion Stage 1](docs/OPINION_MODE_STAGE_1.md)
- [Opinion Stage 2: automatic grouping](docs/OPINION_MODE_STAGE_2.md)
- [Opinion quality, cycles and validation](docs/OPINION_MODE_QUALITY_CYCLES.md)
- [Opinion Stage 3: trend detection](docs/OPINION_MODE_STAGE_3_TRENDS.md)
- [Opinion Stage 3B: topic discovery](docs/OPINION_MODE_STAGE_3B_DISCOVERY.md)

That file explains:
- the user journeys
- the app state machine
- the Supabase schema
- the Edge Functions
- the balance model
- the social features
- the local and production environment rules

## Development

Start the app locally:

```bash
npm start
```

Build for production:

```bash
npm run build
```

## Main Stack

- React
- Tailwind CSS
- Supabase
- Reown AppKit

## Bitcoin Wallet Authentication

Every transport signs the same server-issued, short-lived Bitcoin Access challenge. Wallet brands are not part of the authentication model.

Authentication security:

- every challenge is generated server-side, expires after ten minutes and can be consumed only once
- raw messages, signatures and PSBT proofs are never persisted as account credentials
- the browser receives a revocable refresh session in an `HttpOnly` cookie
- the short-lived access token stays in memory and is never stored in `localStorage`
- disconnecting a wallet does not end the website session; `Log out` revokes it
- public profiles and private account data use separate Edge Functions

Desktop coverage is layered:

1. **Automatic connection** uses the Bitcoin connector exposed to AppKit. The installed adapter discovers compatible injected providers, Bitcoin Wallet Standard, Sats Connect, WalletConnect, UniSat-style providers, OKX, Bitget, Binance Web3, Leather, Phantom, and Xverse without application-level signing branches.
2. **Other desktop wallet** bypasses Reown. The user enters a public Bitcoin address, signs the portable challenge with the wallet's message-signing feature, and pastes the signature for the same server-side verification.
3. **PSBT proof** is the brand-independent fallback for wallets that can sign PSBTs but cannot sign messages. Bitcoin Access builds a BIP-322 virtual transaction that cannot be broadcast and never moves funds or pays a fee. It supports Legacy P2PKH, Nested SegWit P2SH-P2WPKH, Native SegWit P2WPKH and Native SegWit multisig P2WSH. The same request can be signed through a compatible connected provider, an animated `crypto-psbt` BC-UR QR exchange, or a `.psbt` file.

No browser application can automatically support an unknown proprietary wallet API. New wallets become automatic when they implement one of the discovered standards; until then, message-signature or PSBT proof provides the brand-independent path.

Hardware and multisig coverage:

- **Hardware / single signature:** import a public `pkh(...)`, `wpkh(...)` or `sh(wpkh(...))` output descriptor to derive the selected receive or change address and include its BIP32 key origin in the PSBT. The request can then be signed directly, by animated QR, or by file.
- **Ledger USB (beta):** on a secure desktop Chromium browser, a Ledger can expose the public Native SegWit account descriptor and verify the selected address on-device. Bitcoin Access compares the device address with a locally derived `m/84'/0'/account'/branch/index` address before creating or signing the BIP-322 PSBT. The device is disconnected after each operation and no seed, private key or persistent USB session is stored. A physical-device compatibility test is required before removing the beta label.
- **Trezor USB (beta):** the Hardware screen uses the official Trezor Connect window to display and confirm a standard mainnet Native SegWit address at `m/84'/0'/account'/branch/index`, then signs only the short-lived server challenge. The returned signature is bound to the address confirmed on-device and is verified by the same server path as other Bitcoin message signatures. No transaction or broadcast API is called.
- **Jade USB and QR (beta):** compatible Chromium browsers communicate directly with Jade through its public CBOR-over-serial RPC protocol, verify a standard Native SegWit address on-device, and request only a message signature. A camera-equipped Jade can instead remain air-gapped by scanning its native `signmessage ... ascii:...` QR and returning the Base64 signature as a QR. The PIN is entered only on Jade; the browser can relay the firmware's encrypted blind-oracle request only to official Jade PIN-server HTTPS origins.
- **Native SegWit multisig:** import a public `wsh(multi(...))` or `wsh(sortedmulti(...))` descriptor. The app derives the witness script and address, then the server verifies every signature and enforces the policy threshold. Manual address and witness-script entry remains available as a fallback.
- **Animated QR:** outbound and signed PSBTs use the standard `crypto-psbt` BC-UR type. Fountain-code fragments can be scanned in any order and tolerate missed frames.
- **Current BIP-322 PSBT metadata:** every generated request includes `PSBT_GLOBAL_GENERIC_SIGNED_MESSAGE` (`0x09`), allowing compatible signers to identify and display the UTF-8 authentication message instead of presenting the proof as an ordinary payment.
- The witness script and PSBT contain public wallet-policy data. The app never requests a seed phrase, private key, real UTXO, payment, or broadcast permission.

Descriptor import currently accepts mainnet public `xpub`, `ypub`, `zpub`, `Ypub`, `Zpub` and compressed public keys. Private extended keys are rejected. Descriptor checksums are verified when supplied; when absent, the user must compare the derived address with the wallet before signing.

Deployment and production cookie configuration are documented in:

- [Authentication security](docs/AUTHENTICATION_SECURITY.md)

After changing authentication, deploy the migration and all affected Edge Functions as described there. Deploying only `verify-and-register` is not sufficient.
