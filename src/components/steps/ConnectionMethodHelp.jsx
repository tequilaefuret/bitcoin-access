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
  mobile: {
    id: 'mobile-wallet',
    title: 'Mobile wallet',
    steps: [
      'Open Bitcoin Access inside the wallet’s built-in browser.',
      'Use the QR code or copied link if the direct opening button is not supported.',
      'Connect the wallet and approve the ownership signature on your phone.',
    ],
    note: 'Some wallet deep links only open the app. In that case, paste the site link into its in-app browser.',
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

export function getConnectionGuide({ selectedPersonaId, authMode, offlineProofFormat }) {
  if (selectedPersonaId === 'mobile_hot_wallet') return GUIDES.mobile;
  if (selectedPersonaId === 'cold_multisig') return GUIDES.multisig;
  if (selectedPersonaId === 'cold_single_seed') {
    return offlineProofFormat === 'message' ? GUIDES.hardwareMessage : GUIDES.hardwarePsbt;
  }
  if (authMode === 'manual') return GUIDES.browserManual;
  return GUIDES.browserAutomatic;
}

const ConnectionMethodHelp = (props) => {
  const guide = getConnectionGuide(props);

  return (
    <details
      key={guide.id}
      className="group mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"
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
