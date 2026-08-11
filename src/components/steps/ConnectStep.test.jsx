import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConnectStep from './ConnectStep';

const renderConnectStep = (overrides = {}) => render(
  <ConnectStep
    selectedPersonaId="desktop_hot_wallet"
    authMode="direct"
    onPasswordLogin={jest.fn().mockResolvedValue(undefined)}
    {...overrides}
  />
);

test('uses password sign-in as the default returning-user path', async () => {
  const onPasswordLogin = jest.fn().mockResolvedValue(undefined);
  renderConnectStep({ onPasswordLogin });

  fireEvent.change(screen.getByLabelText(/username or bitcoin address/i), {
    target: { value: 'known-user' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'a long account password' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  await waitFor(() => {
    expect(onPasswordLogin).toHaveBeenCalledWith('known-user', 'a long account password');
  });
});

test('requires a wallet proof before password recovery', () => {
  const onPasswordRecovery = jest.fn();
  renderConnectStep({ onPasswordRecovery });

  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

  expect(onPasswordRecovery).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: /use your wallet/i })).toBeInTheDocument();
  expect(screen.getByText(/wallet type/i)).toBeInTheDocument();
});

test('labels an injected Phantom provider as detected in the browser', () => {
  const onConnectInjected = jest.fn();
  renderConnectStep({
    onConnectInjected,
    injectedWallets: [{ id: 'wallet-standard-phantom-0', name: 'Phantom' }],
  });

  fireEvent.click(screen.getByRole('button', { name: /^wallet$/i }));
  expect(screen.getByText(/detected in this browser/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /find another wallet/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /connect with phantom/i }));

  expect(onConnectInjected).toHaveBeenCalledWith('wallet-standard-phantom-0');
});

test('does not show a detected-wallet heading when no extension is detected', () => {
  renderConnectStep({ injectedWallets: [] });

  fireEvent.click(screen.getByRole('button', { name: /^wallet$/i }));

  expect(screen.queryByText(/detected in this browser/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^find a wallet$/i })).toBeInTheDocument();
});

test('shows the mobile QR code immediately on desktop without an open-mobile action', () => {
  renderConnectStep({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: false,
    mobileHandoffUrl: 'https://example.com/?mobileEntry=1',
  });

  fireEvent.click(screen.getByRole('button', { name: /^wallet$/i }));

  expect(screen.getByText(/scan this qr code with your mobile wallet/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /find a wallet/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /open on mobile/i })).not.toBeInTheDocument();
});

test('prioritizes wallet selection on mobile and keeps the QR code as fallback', () => {
  renderConnectStep({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: true,
    mobileHandoffUrl: 'https://example.com/?mobileEntry=1',
  });

  fireEvent.click(screen.getByRole('button', { name: /^wallet$/i }));

  expect(screen.getByRole('button', { name: /find a wallet/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /show qr code and copyable link/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /show qr code and copyable link/i }));
  expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
});

test('uses the detected wallet directly from its in-app browser', () => {
  const onConnect = jest.fn();
  const onConnectInjected = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: true,
    walletInAppBrowser: true,
    injectedWallets: [{ id: 'wallet-standard-phantom-0', name: 'Phantom' }],
    onConnect,
    onConnectInjected,
  });

  fireEvent.click(screen.getByRole('button', { name: /^wallet$/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue with phantom/i }));

  expect(onConnectInjected).toHaveBeenCalledWith('wallet-standard-phantom-0');
  expect(onConnect).not.toHaveBeenCalled();
});

test('offers the direct Trezor journey for a hardware wallet', () => {
  const connectTrezorUsb = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    offlineProofFormat: 'psbt',
    descriptorInput: '',
    descriptorBranch: 0,
    descriptorIndex: 0,
    trezorAccount: 0,
    connectTrezorUsb,
    trezorUsbAvailability: { supported: true, reason: '' },
  });

  fireEvent.click(screen.getByRole('button', { name: /create an account with a wallet/i }));
  expect(screen.getByRole('heading', { name: /direct connection/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^trezor$/i })).toBeInTheDocument();
  expect(screen.getByTestId('trezor-brand-mark')).toHaveClass('bg-[#60E198]', 'text-[#062D16]');
  expect(screen.getByText(/advanced address selection/i).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/how to connect with trezor/i)).toBeInTheDocument();
  expect(screen.getByText(/how to connect with ledger/i)).toBeInTheDocument();
  expect(screen.getByText(/how to connect with jade/i)).toBeInTheDocument();
  expect(screen.queryByText(/how to connect with hardware wallet with psbt/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /connect trezor/i }));

  expect(connectTrezorUsb).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/never enter your seed or approve a real transaction/i)).toBeInTheDocument();
});

test('keeps the direct Ledger journey to one automatic action', () => {
  const connectLedgerUsb = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    offlineProofFormat: 'psbt',
    descriptorInput: '',
    descriptorBranch: 0,
    descriptorIndex: 0,
    ledgerAccount: 0,
    connectLedgerUsb,
    ledgerUsbAvailability: { supported: true, reason: '' },
  });

  fireEvent.click(screen.getByRole('button', { name: /create an account with a wallet/i }));
  expect(screen.getByText(/advanced account selection/i).closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByText(/import wallet policy/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /sign directly/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /connect ledger/i }));

  expect(connectLedgerUsb).toHaveBeenCalledTimes(1);
});

test('opens the official wallet applications for mobile hardware journeys', () => {
  const connectLedger = jest.fn();
  const connectTrezor = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    mobileDevice: true,
    offlineProofFormat: 'psbt',
    descriptorInput: '',
    descriptorBranch: 0,
    descriptorIndex: 0,
    ledgerAccount: 0,
    trezorAccount: 0,
    connectLedgerUsb: connectLedger,
    connectTrezorUsb: connectTrezor,
    ledgerUsbAvailability: {
      supported: true,
      mode: 'wallet-app',
      actionLabel: 'Connect Ledger',
      reason: 'Continue securely through the wallet selector.',
    },
    trezorUsbAvailability: {
      supported: true,
      mode: 'suite-app',
      actionLabel: 'Connect Trezor',
      reason: 'Continue securely in the Trezor Suite mobile app.',
    },
  });

  fireEvent.click(screen.getByRole('button', { name: /^connect trezor$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^connect ledger$/i }));

  expect(connectTrezor).toHaveBeenCalledTimes(1);
  expect(connectLedger).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/continue in trezor suite to confirm your address/i)).toBeInTheDocument();
  expect(screen.getByText(/continue with ledger wallet through the secure wallet selector/i)).toBeInTheDocument();
});

test('offers Jade through direct USB and native QR proof journeys', () => {
  const selectOfflineProofFormat = jest.fn();
  const connectJadeUsb = jest.fn();
  const prepareJadeQrProof = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    offlineProofFormat: 'psbt',
    descriptorInput: '',
    descriptorBranch: 0,
    descriptorIndex: 0,
    manualAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    selectOfflineProofFormat,
    connectJadeUsb,
    prepareJadeQrProof,
    jadeUsbAvailability: { supported: true, reason: '' },
  });

  fireEvent.click(screen.getByRole('button', { name: /create an account with a wallet/i }));

  expect(screen.getByRole('heading', { name: /^jade$/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /connect jade by usb/i }));
  expect(connectJadeUsb).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /use jade qr/i }));

  expect(selectOfflineProofFormat).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: /jade air-gapped qr/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /import wallet policy/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /create jade qr request/i }));
  expect(prepareJadeQrProof).toHaveBeenCalledTimes(1);
});

test('shows the prepared Jade signmessage QR and submits its signature', () => {
  const submitJadeQrProof = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'direct',
    authRequest: {
      requestId: 'jade-request',
      challengePreview: 'Bitcoin Access authentication',
      proofFormat: null,
    },
    authHint: 'Scan this exact request with Jade.',
    manualAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    manualSignature: 'Jade signature',
    jadeQrPayload: 'signmessage m/84h/0h/0h/0/0 ascii:Bitcoin Access authentication',
    jadeQrPath: 'm/84h/0h/0h/0/0',
    submitJadeQrProof,
  });

  fireEvent.click(screen.getByRole('button', { name: /create an account with a wallet/i }));
  expect(screen.getByText(/jade qr request ready/i)).toBeInTheDocument();
  expect(screen.getByText('m/84h/0h/0h/0/0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));
  expect(submitJadeQrProof).toHaveBeenCalledTimes(1);
});
