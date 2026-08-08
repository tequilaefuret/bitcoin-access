export function hasUserProfile(user) {
  return Boolean(
    user?.has_profile ||
    user?.profile?.display_name ||
    user?.profile_display_name ||
    user?.display_name
  );
}

export async function loadAuthenticatedUser(address, loadUser) {
  const user = await loadUser(address, { throwOnError: true });

  if (!user) {
    throw new Error('User not found after verification');
  }

  return user;
}
