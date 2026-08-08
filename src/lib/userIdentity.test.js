import { hasUserProfile, loadAuthenticatedUser } from './userIdentity';

test('loads the canonical profile after authentication', async () => {
  const canonicalUser = {
    bitcoin_address: 'bc1q-known',
    profile: { display_name: 'known-user' },
    has_profile: true
  };
  const loadUser = jest.fn().mockResolvedValue(canonicalUser);

  await expect(loadAuthenticatedUser('bc1q-known', loadUser)).resolves.toBe(canonicalUser);
  expect(loadUser).toHaveBeenCalledWith('bc1q-known', { throwOnError: true });
  expect(hasUserProfile(canonicalUser)).toBe(true);
});

test('does not treat a failed canonical lookup as a missing profile', async () => {
  const loadUser = jest.fn().mockRejectedValue(new Error('Profile lookup unavailable'));

  await expect(loadAuthenticatedUser('bc1q-known', loadUser)).rejects.toThrow(
    'Profile lookup unavailable'
  );
});
