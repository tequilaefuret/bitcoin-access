import React from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';

const GUIDES = {
  browserAutomatic: {
    id: 'browser-automatic',
    title: 'Browser wallet',
    steps: [
      'Select Find a wallet and choose an installed or WalletConnect-compatible wallet.',
      'Accept the connection request in the wallet.',
      'Approve the ownership signature. This is not a Bitcoin transaction.',
    ],
    note: 'If your wallet is not detected, switch to Manual signature.',
  },
  browserManual: {
    id: 'browser-manual',
    title: 'Manual signature',
    steps: [
      'Enter the public Bitcoin address you want to use.',
      'Generate and copy the challenge exactly as displayed.',
      'Use your wallet’s Sign message feature, then paste the returned signature.',
    ],
    note: 'Never paste a seed phrase or private key. Only the public address and signature are required.',
  },
  mobileDesktop: {
    id: 'mobile-wallet-desktop',
    title: 'Mobile wallet from desktop',
    steps: [
      'Scan the QR code with the scanner in your mobile wallet.',
      'Open Bitcoin Access in the wallet’s browser and select Find a wallet.',
      'Approve the connection and the ownership signature on your phone.',
    ],
    note: 'If the wallet cannot scan website QR codes, copy the link and open it in the wallet’s in-app browser.',
  },
  mobileBrowser: {
    id: 'mobile-wallet-browser',
    title: 'Mobile wallet',
    steps: [
      'Select Find a wallet and choose a compatible app.',
      'Approve the connection in the wallet app.',
      'Approve the ownership signature, then return to this browser manually if needed.',
    ],
    note: 'The QR code and copyable link remain available as a fallback for a wallet with an in-app browser.',
  },
  mobileInApp: {
    id: 'mobile-wallet-in-app',
    title: 'Wallet browser',
    steps: [
      'Continue with the wallet detected in this browser, or select Find a wallet.',
      'Approve access to the Bitcoin payment address.',
      'Approve the ownership signature. The connected account appears only after verification.',
    ],
    note: 'A wallet connection alone does not authenticate the Bitcoin Access account.',
  },
  hardwarePsbt: {
    id: 'hardware-psbt',
    title: 'Hardware wallet with PSBT',
    steps: [
      'Export the public wallet descriptor from your hardware wallet companion app.',
      'Import it here and confirm that the derived address matches your wallet.',
      'Create the request, then sign directly, scan the animated QR, or use the PSBT file.',
      'Return the signed PSBT and select Verify and sign in.',
    ],
    note: 'The descriptor is public. The virtual PSBT cannot move bitcoin or charge a fee. Never export a private descriptor.',
  },
  hardwareMessage: {
    id: 'hardware-message',
    title: 'Hardware wallet with message signature',
    steps: [
      'Enter the public address managed by the hardware wallet.',
      'Generate the authentication challenge.',
      'Sign that exact message through the wallet’s companion software.',
      'Paste the returned signature into Bitcoin Access.',
    ],
    note: 'This option depends on the companion software exposing a Bitcoin message-signing feature.',
  },
  hardwareTrezorDirect: {
    id: 'hardware-trezor-direct',
    title: 'Trezor',
    steps: [
      'Connect and unlock your Trezor, then select Connect Trezor.',
      'Allow the official Trezor window to access the device and confirm the displayed Bitcoin address.',
      'Review and approve the login message on the Trezor screen.',
      'Return to Danaus if needed. Ownership verification and sign-in complete automatically.',
    ],
    note: 'You are signing a login message, not sending bitcoin. Never enter your wallet backup on this site.',
  },
  hardwareTrezorSuite: {
    id: 'hardware-trezor-suite',
    title: 'Trezor',
    steps: [
      'Connect and unlock your Trezor in the official Trezor Suite mobile app.',
      'Return here and select Connect Trezor to continue in Trezor Suite.',
      'Confirm the Bitcoin address, then review and approve the login message.',
      'Return to Danaus if needed. Ownership verification and sign-in complete automatically.',
    ],
    note: 'On iPhone, hardware signing requires a Bluetooth-compatible Trezor. Never enter your wallet backup on this site.',
  },
  hardwareLedgerDirect: {
    id: 'hardware-ledger-direct',
    title: 'Ledger',
    steps: [
      'Connect and unlock your Ledger, open the Bitcoin app, then select Connect Ledger.',
      'Choose the device in the browser permission window.',
      'Verify the Bitcoin address and approve the login message on the Ledger screen.',
      'Keep the page open while Danaus verifies the signature and signs you in automatically.',
    ],
    note: 'No bitcoin is sent and no network fee is charged. Never enter your recovery phrase on this site.',
  },
  hardwareLedgerWallet: {
    id: 'hardware-ledger-wallet',
    title: 'Ledger',
    steps: [
      'Select Connect Ledger, then choose Ledger Wallet in the secure wallet selector.',
      'Approve the connection request in Ledger Wallet.',
      'Review and approve the Danaus login message with your Ledger.',
      'Return to this browser if needed. Sign-in completes after the signature is verified.',
    ],
    note: 'The mobile journey uses Ledger Wallet because direct browser access to the device is unavailable on mobile.',
  },
  hardwareJadeUsb: {
    id: 'hardware-jade-usb',
    title: 'Jade by USB',
    steps: [
      'Connect and unlock Jade, then select Connect Jade by USB and choose its serial port in the browser window.',
      'If Jade is locked, enter the PIN only on Jade. Danaus only relays the encrypted PIN-server message.',
      'Verify the Native SegWit address and the login message on the Jade screen, then approve both.',
      'Keep the page open while the signature is verified and sign-in completes automatically.',
    ],
    note: 'No transaction is created. On mobile, a USB-C connection owned by the Blockstream app is not available to this browser; use Jade QR or desktop USB. If Jade cannot unlock in the current Blockstream app, update the app and Jade firmware before retrying. Never enter the PIN, seed or wallet backup on this site.',
  },
  hardwareJadeQr: {
    id: 'hardware-jade-qr',
    title: 'Jade QR',
    steps: [
      'Start and unlock an air-gapped Jade session, then open Options, Wallet, Export Xpub.',
      'Keep Native SegWit and Singlesig selected. Scan Jade’s animated crypto-account QR with Danaus; the public address is derived automatically.',
      'Create the signing request, open Scan QR on Jade and keep it pointed at Danaus’s animated QR until progress completes.',
      'Verify the login message and path on Jade, approve it, then scan Jade’s signature QR with Danaus and select Verify and sign in.',
    ],
    note: 'The imported xpub is public and is accepted only for Bitcoin mainnet Native SegWit singlesig. Danaus never scans a SeedQR or private key. This proof is a signed message—not a PSBT—and cannot move bitcoin.',
  },
  multisig: {
    id: 'multisig-psbt',
    title: 'Multisig wallet',
    steps: [
      'Export the public multisig descriptor from your coordinator and import it here.',
      'Confirm the derived address and signing threshold, then create the request.',
      'Pass the PSBT between signers directly, by animated QR, or with a file.',
      'After reaching the policy threshold, return the PSBT and verify it.',
    ],
    note: 'Supported today: wsh(multi(...)) and wsh(sortedmulti(...)) Native SegWit policies. Public keys and derivation paths are not secrets.',
  },
};

export function getConnectionGuide({
  guideId,
  selectedPersonaId,
  authMode,
  offlineProofFormat,
  mobileDevice = false,
  walletInAppBrowser = false,
}) {
  if (guideId) {
    const explicitGuide = Object.values(GUIDES).find((guide) => guide.id === guideId);
    if (explicitGuide) return explicitGuide;
  }
  if (selectedPersonaId === 'mobile_hot_wallet') {
    if (!mobileDevice) return GUIDES.mobileDesktop;
    return walletInAppBrowser ? GUIDES.mobileInApp : GUIDES.mobileBrowser;
  }
  if (selectedPersonaId === 'cold_multisig') return GUIDES.multisig;
  if (selectedPersonaId === 'cold_single_seed') {
    return offlineProofFormat === 'message' ? GUIDES.hardwareMessage : GUIDES.hardwarePsbt;
  }
  if (authMode === 'manual') return GUIDES.browserManual;
  return GUIDES.browserAutomatic;
}

const ConnectionMethodHelp = ({ compact = false, ...props }) => {
  const guide = getConnectionGuide(props);

  return (
    <details
      key={guide.id}
      data-testid="connection-method-help"
      className={`group overflow-hidden border border-slate-200 bg-white ${compact ? 'mt-1 rounded-xl' : 'mt-5 rounded-2xl'}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-slate-700 marker:hidden hover:bg-slate-50">
        <span className="inline-flex min-w-0 items-center gap-2">
          <CircleHelp className="h-4 w-4 shrink-0 text-orange-500" />
          How to connect with {guide.title}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-slate-100 px-4 py-4">
        <ol className="grid gap-3">
          {guide.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-5 text-slate-600">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[11px] font-bold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-5 text-orange-900">
          {guide.note}
        </p>
      </div>
    </details>
  );
};

export default ConnectionMethodHelp;
