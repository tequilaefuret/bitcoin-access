import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileStep from './ProfileStep';
import {
  getPublicProfile,
  getPublicUserMessages,
  getPublicUserUsefulMessages,
  getUserData,
  getUserMessages,
  getUserStats,
} from '../../supabaseClient';

jest.mock('../../supabaseClient', () => ({
  getUserData: jest.fn(),
  getPublicProfile: jest.fn(),
  getPublicUserMessages: jest.fn(),
  getPublicUserUsefulMessages: jest.fn(),
  getUserMessages: jest.fn(),
  getUserStats: jest.fn(),
  truncateAddress: (address) => `${address.slice(0, 8)}...${address.slice(-6)}`,
}));

const address = 'bc1qabcdefghijklmnopqrstuvwxyz123456';

beforeEach(() => {
  getUserData.mockResolvedValue({
    profile: { display_name: 'screen-safe-user' },
    ownership_verified: true,
  });
  getUserStats.mockResolvedValue({});
  getUserMessages.mockResolvedValue([]);
  getPublicProfile.mockResolvedValue({ profile: { display_name: 'public-writer' } });
  getPublicUserMessages.mockResolvedValue([]);
  getPublicUserUsefulMessages.mockResolvedValue([]);
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

test('shows the complete profile address only when the preference is enabled', async () => {
  render(
    <ProfileStep
      profileAddress={address}
      currentAddress={address}
      onBack={jest.fn()}
      showFullAddress
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
