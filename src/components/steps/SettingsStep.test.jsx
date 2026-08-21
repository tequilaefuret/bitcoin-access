import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsStep from './SettingsStep';
import { changePassword } from '../../supabaseClient';

jest.mock('../../supabaseClient', () => ({
  changePassword: jest.fn(),
  truncateAddress: (address) => address,
}));

const preferences = {
  defaultFeed: 'for_you',
  motion: 'system',
  addressDisplay: 'shortened',
  balanceDisplay: 'show_all',
};

beforeEach(() => {
  changePassword.mockReset();
});

test('changes the password after collecting the current password and matching confirmation', async () => {
  changePassword.mockResolvedValue({ changed: true });
  render(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured
      preferences={preferences}
      onPreferencesChange={jest.fn()}
      onBack={jest.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/^current password$/i), {
    target: { value: 'current password phrase' },
  });
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: 'a brand new password phrase' },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: 'a brand new password phrase' },
  });
  fireEvent.click(screen.getByRole('button', { name: /update password/i }));

  await waitFor(() => {
    expect(changePassword).toHaveBeenCalledWith(
      'current password phrase',
      'a brand new password phrase'
    );
    expect(screen.getByRole('status')).toHaveTextContent(/other active sessions have been signed out/i);
  });
});

test('does not submit when the new password confirmation differs', () => {
  render(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured
      preferences={preferences}
      onPreferencesChange={jest.fn()}
      onBack={jest.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/^current password$/i), {
    target: { value: 'current password phrase' },
  });
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: 'a brand new password phrase' },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: 'a different confirmation' },
  });

  expect(screen.getByRole('button', { name: /update password/i })).toBeDisabled();
  expect(changePassword).not.toHaveBeenCalled();
});

test('updates feed, animation, and address privacy preferences', () => {
  const onPreferencesChange = jest.fn();
  const { rerender } = render(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured
      preferences={preferences}
      onPreferencesChange={onPreferencesChange}
      onBack={jest.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/default feed/i), { target: { value: 'recent' } });
  expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...preferences, defaultFeed: 'recent' });

  const updatedPreferences = { ...preferences, defaultFeed: 'recent' };
  rerender(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured
      preferences={updatedPreferences}
      onPreferencesChange={onPreferencesChange}
      onBack={jest.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText(/animations/i), { target: { value: 'reduced' } });
  expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...updatedPreferences, motion: 'reduced' });

  fireEvent.change(screen.getByLabelText(/show bitcoin address/i), { target: { value: 'full' } });
  expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...updatedPreferences, addressDisplay: 'full' });

  fireEvent.change(screen.getByLabelText(/show balance/i), { target: { value: 'hide_bitcoin' } });
  expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...updatedPreferences, balanceDisplay: 'hide_bitcoin' });
});

test('offers password creation when the account has no password', () => {
  const onAddPassword = jest.fn();
  render(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured={false}
      preferences={preferences}
      onPreferencesChange={jest.fn()}
      onAddPassword={onAddPassword}
      onBack={jest.fn()}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /create a password/i }));
  expect(onAddPassword).toHaveBeenCalledTimes(1);
});

test('lists content controls and lets the user restore an account', async () => {
  const onLoadEditorialPreferences = jest.fn().mockResolvedValue([
    {
      target_address: 'bc1q-muted-author',
      display_name: 'muted-writer',
      preference: 'mute',
    },
  ]);
  const onEditorialPreference = jest.fn().mockResolvedValue({ success: true, active: false });

  render(
    <SettingsStep
      address="bc1q-test-address"
      passwordConfigured
      preferences={preferences}
      onPreferencesChange={jest.fn()}
      onLoadEditorialPreferences={onLoadEditorialPreferences}
      onEditorialPreference={onEditorialPreference}
      onBack={jest.fn()}
    />
  );

  expect(await screen.findByText('muted-writer')).toBeInTheDocument();
  expect(screen.getByText('Hidden')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /restore muted-writer/i }));

  await waitFor(() => {
    expect(onEditorialPreference).toHaveBeenCalledWith('bc1q-muted-author', 'none');
    expect(screen.queryByText('muted-writer')).not.toBeInTheDocument();
  });
  expect(screen.getByRole('status')).toHaveTextContent(/visible and can interact/i);
});
