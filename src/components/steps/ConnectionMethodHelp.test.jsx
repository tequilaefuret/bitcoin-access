import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConnectionMethodHelp, { getConnectionGuide } from './ConnectionMethodHelp';

test('keeps connection instructions closed by default and opens them on request', () => {
  const { container } = render(
    <ConnectionMethodHelp
      selectedPersonaId="desktop_hot_wallet"
      authMode="direct"
      offlineProofFormat="psbt"
    />
  );

  const disclosure = container.querySelector('details');
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
