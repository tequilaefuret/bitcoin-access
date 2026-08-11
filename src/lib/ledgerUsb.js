import { Buffer } from 'buffer';
import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit';
import {
  DefaultDescriptorTemplate,
  DefaultWallet,
  SignerBtcBuilder,
} from '@ledgerhq/device-signer-kit-bitcoin';
import {
  webHidIdentifier,
  webHidTransportFactory,
} from '@ledgerhq/device-transport-kit-web-hid';
import {
  assertLedgerInteger,
  buildLedgerDescriptor,
  encodeLedgerMessageSignature,
  ledgerAccountPath,
  validateLedgerSigningRequest,
} from './ledgerUsbValidation';

export {
  buildLedgerDescriptor,
  encodeLedgerMessageSignature,
  ledgerAccountPath,
  validateLedgerSigningRequest,
} from './ledgerUsbValidation';

const ACTION_TIMEOUT_MS = 300_000;
const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

const errorMessage = (error, fallback) => {
  const message = error?.message || error?.originalError?.message;
  if (/no selected device|no accessible device|cancel/i.test(message || '')) {
    return 'No Ledger selected. Connect it and accept the browser device prompt.';
  }
  if (/locked/i.test(message || '')) return 'Unlock your Ledger and try again.';
  return message || fallback;
};

const interactionLabel = (state) => {
  const interaction = state?.intermediateValue?.requiredUserInteraction || '';
  if (/unlock/i.test(interaction)) return 'Unlock your Ledger.';
  if (/openapp|confirmopenapp/i.test(interaction)) return 'Approve opening the Bitcoin app on your Ledger.';
  if (/verifyaddress/i.test(interaction)) return 'Verify and approve the address shown on your Ledger.';
  if (/signmessage/i.test(interaction)) return 'Review and approve the login message on your Ledger.';
  if (/signtransaction/i.test(interaction)) return 'Review and approve the proof on your Ledger.';
  return 'Continue on your Ledger.';
};

const waitForAction = (action, onStatus) => new Promise((resolve, reject) => {
  let subscription;
  let settled = false;

  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    subscription?.unsubscribe();
    callback(value);
  };

  const timeout = setTimeout(() => {
    action.cancel();
    finish(reject, new Error('The Ledger request timed out. Reconnect the device and try again.'));
  }, ACTION_TIMEOUT_MS);

  subscription = action.observable.subscribe({
    next: (state) => {
      if (state.status === DeviceActionStatus.Pending) onStatus?.(interactionLabel(state));
      if (state.status === DeviceActionStatus.Completed) finish(resolve, state.output);
      if (state.status === DeviceActionStatus.Error) {
        finish(reject, new Error(errorMessage(state.error, 'Ledger rejected the request.')));
      }
      if (state.status === DeviceActionStatus.Stopped) {
        finish(reject, new Error('The Ledger request was stopped.'));
      }
    },
    error: (error) => finish(reject, new Error(errorMessage(error, 'Unable to communicate with Ledger.'))),
    complete: () => {
      if (!settled) finish(reject, new Error('Ledger ended the request without returning a result.'));
    },
  });
});

const discoverLedger = (dmk, onStatus) => new Promise((resolve, reject) => {
  let subscription;
  let settled = false;
  const timeout = setTimeout(() => {
    subscription?.unsubscribe();
    reject(new Error('No Ledger was detected. Check the cable and browser permission.'));
  }, 30_000);

  onStatus?.('Select your Ledger in the browser device window.');
  subscription = dmk.startDiscovering({ transport: webHidIdentifier }).subscribe({
    next: (device) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      resolve(device);
    },
    error: (error) => {
      settled = true;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      reject(new Error(errorMessage(error, 'Unable to detect Ledger through the direct connection.')));
    },
  });
});

const withLedger = async (operation, onStatus) => {
  assertLedgerUsbSupport();
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(webHidTransportFactory)
    .build();
  let sessionId = null;

  try {
    const device = await discoverLedger(dmk, onStatus);
    onStatus?.('Connecting securely to Ledger.');
    sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    const signer = new SignerBtcBuilder({ dmk, sessionId }).build();
    return await operation(signer);
  } finally {
    try { await dmk.stopDiscovering(); } catch {}
    if (sessionId) {
      try { await dmk.disconnect({ sessionId }); } catch {}
    }
    dmk.close();
  }
};

export function getLedgerUsbAvailability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'Direct Ledger connection requires a browser.' };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Direct Ledger connection requires HTTPS or localhost.' };
  }
  if (!navigator.hid) {
    return { supported: false, reason: 'Use a desktop Chromium browser with WebHID, such as Chrome, Edge, Brave or Opera.' };
  }
  return { supported: true, reason: '' };
}

export function assertLedgerUsbSupport() {
  const availability = getLedgerUsbAvailability();
  if (!availability.supported) throw new Error(availability.reason);
}

const readLedgerAccount = async ({ signer, account, branch, index, deriveDescriptor, onStatus }) => {
  assertLedgerInteger(index, 'Address index');
  if (![0, 1].includes(branch)) throw new Error('The Ledger address chain must be receive or change.');
  const accountPath = ledgerAccountPath(account);

  onStatus?.('Reading public account information from Ledger.');
  const fingerprintResult = await waitForAction(signer.getMasterFingerprint(), onStatus);
  const xpubResult = await waitForAction(
    signer.getExtendedPublicKey(accountPath, { checkOnDevice: false }),
    onStatus,
  );
  const descriptor = buildLedgerDescriptor({
    fingerprint: bytesToHex(fingerprintResult.masterFingerprint),
    extendedPublicKey: xpubResult.extendedPublicKey,
    account,
  });
  const descriptorInfo = deriveDescriptor(descriptor, { branch, index });
  const wallet = new DefaultWallet(accountPath, DefaultDescriptorTemplate.NATIVE_SEGWIT);
  onStatus?.('Verify the address on your Ledger screen.');
  const verified = await waitForAction(
    signer.getWalletAddress(wallet, index, { change: branch === 1, checkOnDevice: true }),
    onStatus,
  );
  if (verified.address !== descriptorInfo.address) {
    throw new Error('Security check failed: the Ledger address differs from the locally derived address.');
  }
  return { descriptor, descriptorInfo, account, branch, index };
};

const signLedgerPsbt = async (signer, options, { verifyAddress = true } = {}) => {
  const validated = validateLedgerSigningRequest(options);
  const accountPath = ledgerAccountPath(options.account);
  const wallet = new DefaultWallet(accountPath, DefaultDescriptorTemplate.NATIVE_SEGWIT);

  if (verifyAddress) {
    options.onStatus?.('Verify the authentication address on your Ledger screen.');
    const verified = await waitForAction(
      signer.getWalletAddress(wallet, options.index, {
        change: options.branch === 1,
        checkOnDevice: true,
      }),
      options.onStatus,
    );
    if (verified.address !== options.address) {
      throw new Error('Security check failed: Ledger returned a different address.');
    }
  }

  options.onStatus?.('Review and approve the 0 BTC authentication proof on your Ledger.');
  const signatures = await waitForAction(
    signer.signPsbt(wallet, options.unsignedPsbt),
    options.onStatus,
  );
  const partialSignatures = signatures.filter((signature) => (
    signature && 'pubkey' in signature && 'signature' in signature
  ));
  if (partialSignatures.length !== 1) throw new Error('Ledger returned an unexpected number of signatures.');
  const [signature] = partialSignatures;
  if (
    signature.inputIndex !== 0
    || !Buffer.from(signature.pubkey).equals(validated.expectedPubkey)
  ) {
    throw new Error('Ledger signed with a key that does not match the verified address.');
  }
  validated.psbt.updateInput(0, {
    partialSig: [{
      pubkey: Buffer.from(signature.pubkey),
      signature: Buffer.from(signature.signature),
    }],
  });
  return validated.psbt.toBase64();
};

export async function connectLedgerAccount({ account = 0, branch = 0, index = 0, deriveDescriptor, onStatus }) {
  return withLedger((signer) => readLedgerAccount({
    signer,
    account,
    branch,
    index,
    deriveDescriptor,
    onStatus,
  }), onStatus);
}

export async function signLedgerAuthenticationPsbt(options) {
  return withLedger((signer) => signLedgerPsbt(signer, options), options.onStatus);
}

export async function connectAndSignLedgerAuthentication({
  account = 0,
  branch = 0,
  index = 0,
  deriveDescriptor,
  createSigningRequest,
  onStatus,
}) {
  if (typeof createSigningRequest !== 'function') {
    throw new Error('The Ledger authentication request builder is unavailable.');
  }

  return withLedger(async (signer) => {
    const accountResult = await readLedgerAccount({
      signer,
      account,
      branch,
      index,
      deriveDescriptor,
      onStatus,
    });
    onStatus?.('Creating the secure authentication message.');
    const request = await createSigningRequest(accountResult);
    if (typeof request?.message !== 'string' || !request.message.trim()) {
      throw new Error('The Ledger authentication challenge is missing.');
    }
    const derivationPath = `${ledgerAccountPath(account)}/${branch}/${index}`;
    onStatus?.('Review and approve the login message on your Ledger.');
    const signature = encodeLedgerMessageSignature(
      await waitForAction(signer.signMessage(derivationPath, request.message), onStatus),
    );
    return { ...accountResult, signature };
  }, onStatus);
}
