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
