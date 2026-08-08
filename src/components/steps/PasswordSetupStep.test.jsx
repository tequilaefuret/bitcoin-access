import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PasswordSetupStep from './PasswordSetupStep';
import { configurePassword } from '../../supabaseClient';

jest.mock('../../supabaseClient', () => ({
  configurePassword: jest.fn(),
  truncateAddress: (address) => address,
}));

beforeEach(() => {
  configurePassword.mockReset();
});

test('requires matching passwords of at least twelve characters', () => {
  render(<PasswordSetupStep address="bc1q-test-address" onComplete={jest.fn()} />);

  const submit = screen.getByRole('button', { name: /create password/i });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'short' },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: 'short' },
  });
  expect(submit).toBeDisabled();
});

test('saves a valid password and completes the setup', async () => {
  const onComplete = jest.fn();
  configurePassword.mockResolvedValue({ configured: true });
  render(<PasswordSetupStep address="bc1q-test-address" onComplete={onComplete} />);

  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create password/i }));

  await waitFor(() => {
    expect(configurePassword).toHaveBeenCalledWith('correct horse battery staple', { reset: false });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

test('allows the user to continue with wallet authentication only', async () => {
  const onSkip = jest.fn().mockResolvedValue(undefined);
  render(
    <PasswordSetupStep
      address="bc1q-test-address"
      onComplete={jest.fn()}
      onSkip={onSkip}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /continue with wallet only/i }));

  await waitFor(() => {
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
