import { fireEvent, render, screen } from '@testing-library/react';
import Header from './Header';

test('opens Settings from the private-session menu and hides the full address by default', () => {
  const onSettings = jest.fn();
  render(
    <Header
      connectedAddress="bc1qabcdefghijklmnopqrstuvwxyz123456"
      displayName="screen-safe-user"
      onDisconnect={jest.fn()}
      onSettings={onSettings}
      onHome={jest.fn()}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /private session/i }));
  expect(screen.getAllByText('screen-safe-user').length).toBeGreaterThan(0);
  expect(screen.getByText('bc1qabcd...123456')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));
  expect(onSettings).toHaveBeenCalledTimes(1);
});

test('shows the signed-in profile photo in the header button', () => {
  render(
    <Header
      connectedAddress="bc1qabcdefghijklmnopqrstuvwxyz123456"
      displayName="screen-safe-user"
      avatarUrl="https://media.example/avatar.webp"
      onDisconnect={jest.fn()}
      onHome={jest.fn()}
    />
  );

  expect(screen.getByRole('img', { name: /screen-safe-user's profile/i }))
    .toHaveAttribute('src', 'https://media.example/avatar.webp');
});

test('uses an application grid icon for the Danaus apps menu', () => {
  render(
    <Header
      connectedAddress="bc1qabcdefghijklmnopqrstuvwxyz123456"
      displayName="screen-safe-user"
      onDisconnect={jest.fn()}
      onHome={jest.fn()}
      onOpenGame={jest.fn()}
      onOpenCanvas={jest.fn()}
    />
  );

  const appsButton = screen.getByRole('button', { name: /open danaus apps/i });
  expect(appsButton.querySelector('.lucide-layout-grid')).toBeInTheDocument();
});
