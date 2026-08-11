import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConnectionMethodHelp, { getConnectionGuide } from './ConnectionMethodHelp';

test('keeps connection instructions closed by default and opens them on request', () => {
  render(
    <ConnectionMethodHelp
      selectedPersonaId="desktop_hot_wallet"
      authMode="direct"
      offlineProofFormat="psbt"
    />
  );

  const disclosure = screen.getByTestId('connection-method-help');
  expect(disclosure).not.toHaveAttribute('open');

  fireEvent.click(screen.getByText('How to connect with Browser wallet'));
  expect(disclosure).toHaveAttribute('open');
  expect(screen.getByText(/Accept the connection request/)).toBeInTheDocument();
});

test('selects specific instructions for hardware message signing and multisig', () => {
  expect(getConnectionGuide({
    selectedPersonaId: 'cold_single_seed',
    authMode: 'offline',
    offlineProofFormat: 'message',
  }).id).toBe('hardware-message');

  expect(getConnectionGuide({
    selectedPersonaId: 'cold_multisig',
    authMode: 'offline',
    offlineProofFormat: 'psbt',
  }).id).toBe('multisig-psbt');
});

test('selects wallet-specific hardware instructions', () => {
  expect(getConnectionGuide({ guideId: 'hardware-trezor-direct' }).title).toBe('Trezor');
  expect(getConnectionGuide({ guideId: 'hardware-trezor-suite' }).steps.join(' ')).toMatch(/Trezor Suite mobile app/);
  expect(getConnectionGuide({ guideId: 'hardware-ledger-direct' }).steps.join(' ')).toMatch(/open the Bitcoin app/);
  expect(getConnectionGuide({ guideId: 'hardware-ledger-wallet' }).steps.join(' ')).toMatch(/Ledger Wallet/);
  expect(getConnectionGuide({ guideId: 'hardware-jade-usb' }).steps.join(' ')).toMatch(/serial port/);
  expect(getConnectionGuide({ guideId: 'hardware-jade-qr' }).steps.join(' ')).toMatch(/Scan QR/);
});

test('selects a mobile guide based on the browser context', () => {
  expect(getConnectionGuide({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: false,
  }).id).toBe('mobile-wallet-desktop');

  expect(getConnectionGuide({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: true,
  }).id).toBe('mobile-wallet-browser');

  expect(getConnectionGuide({
    selectedPersonaId: 'mobile_hot_wallet',
    mobileDevice: true,
    walletInAppBrowser: true,
  }).id).toBe('mobile-wallet-in-app');
});
