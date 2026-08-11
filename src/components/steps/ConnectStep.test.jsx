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
  expect(screen.getByText(/advanced address selection/i).closest('details')).not.toHaveAttribute('open');
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

test('offers Jade through the secure companion and QR proof journeys', () => {
  const selectOfflineProofFormat = jest.fn();
  renderConnectStep({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    offlineProofFormat: 'psbt',
    descriptorInput: '',
    descriptorBranch: 0,
    descriptorIndex: 0,
    selectOfflineProofFormat,
  });

  fireEvent.click(screen.getByRole('button', { name: /create an account with a wallet/i }));

  expect(screen.getByRole('heading', { name: /^jade$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /use companion app/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /jade plus qr \/ psbt/i }));

  expect(selectOfflineProofFormat).toHaveBeenCalledWith('psbt');
  expect(screen.getByRole('heading', { name: /import wallet policy/i })).toBeInTheDocument();
});
