import { fireEvent, render, screen } from '@testing-library/react';
import Header from './Header';

test('opens Settings from the private-session menu and hides the full address by default', () => {
  const onSettings = jest.fn();
  render(
    <Header
      connectedAddress="bc1qabcdefghijklmnopqrstuvwxyz123456"
      connectedWallet="Test wallet"
      onDisconnect={jest.fn()}
      onSettings={onSettings}
      onHome={jest.fn()}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /private session/i }));
  expect(screen.getByText('bc1qabcd...123456')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));
  expect(onSettings).toHaveBeenCalledTimes(1);
});
