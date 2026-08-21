import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileStep from './ProfileStep';
import {
  getPublicProfile,
  getProfileMessages,
  getUserData,
  getUserStats,
} from '../../supabaseClient';

jest.mock('../../supabaseClient', () => ({
  getUserData: jest.fn(),
  getPublicProfile: jest.fn(),
  getProfileMessages: jest.fn(),
  getUserStats: jest.fn(),
  getPublicProfileConnections: jest.fn().mockResolvedValue({ accounts: [], total: 0 }),
  uploadProfileMedia: jest.fn(),
  removeProfileMedia: jest.fn(),
  upsertUserProfile: jest.fn(),
  truncateAddress: (address) => `${address.slice(0, 8)}...${address.slice(-6)}`,
}));

const address = 'bc1qabcdefghijklmnopqrstuvwxyz123456';

beforeEach(() => {
  jest.clearAllMocks();
  getUserData.mockResolvedValue({
    profile: { display_name: 'screen-safe-user' },
    ownership_verified: true,
  });
  getUserStats.mockResolvedValue({});
  getProfileMessages.mockResolvedValue({ messages: [], new_balance: 100 });
  getPublicProfile.mockResolvedValue({ profile: { display_name: 'public-writer' } });
});

test('loads and bills only the profile tab that is actually opened', async () => {
  render(
    <ProfileStep
      profileAddress={address}
      currentAddress={address}
      onBack={jest.fn()}
    />
  );

  await waitFor(() => expect(getProfileMessages).toHaveBeenCalledWith(address, address, 'posts', 25, 0));
  expect(getProfileMessages.mock.calls.some((call) => call[2] === 'useful')).toBe(false);

  fireEvent.click(await screen.findByRole('button', { name: /replies/i }));
  await waitFor(() => expect(getProfileMessages).toHaveBeenCalledWith(address, address, 'replies', 25, 0));
  expect(getProfileMessages.mock.calls.some((call) => call[2] === 'useful')).toBe(false);
});

test('shortens the address on the personal profile by default', async () => {
  render(
    <ProfileStep
      profileAddress={address}
      currentAddress={address}
      onBack={jest.fn()}
    />
  );

  expect(screen.getByText('bc1qabcd...123456')).toBeInTheDocument();
  expect(screen.queryByText(address)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('screen-safe-user')).toBeInTheDocument());
});

test('does not show a placeholder username while the real profile is loading', () => {
  getUserData.mockReturnValueOnce(new Promise(() => {}));
  render(
    <ProfileStep
      profileAddress={address}
      currentAddress={address}
      onBack={jest.fn()}
    />
  );

  expect(screen.queryByText(/anonymous/i)).not.toBeInTheDocument();
});

test('shows profile totals without loading every tab', async () => {
  getUserData.mockResolvedValueOnce({
    profile: { display_name: 'screen-safe-user' },
    profile_counts: { posts: 12, replies: 8, reposts: 4, useful: 17 },
    ownership_verified: true,
  });

  render(<ProfileStep profileAddress={address} currentAddress={address} onBack={jest.fn()} />);

  expect(await screen.findByRole('button', { name: /posts 12/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /replies 8/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /reposts 4/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /useful 17/i })).toBeInTheDocument();
  expect(getProfileMessages.mock.calls.some((call) => call[2] === 'replies')).toBe(false);
});

test('shows the complete profile address only when the preference is enabled', async () => {
  render(
    <ProfileStep
      profileAddress={address}
      currentAddress={address}
      onBack={jest.fn()}
      addressDisplay="full"
    />
  );

  expect(screen.getByText(address)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('screen-safe-user')).toBeInTheDocument());
});

test('reports another profile from its options menu', async () => {
  const onReportProfile = jest.fn().mockResolvedValue({ created: true, report_count: 1 });
  render(
    <ProfileStep
      profileAddress="bc1q-public-writer"
      currentAddress="bc1q-current-reader"
      onBack={jest.fn()}
      onReportProfile={onReportProfile}
    />
  );

  await waitFor(() => expect(screen.getByText('public-writer')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /profile options/i }));
  fireEvent.click(screen.getByRole('button', { name: /report this profile/i }));

  await waitFor(() => {
    expect(onReportProfile).toHaveBeenCalledWith('bc1q-public-writer');
  });
  expect(await screen.findByText(/profile report recorded/i)).toBeInTheDocument();
});
