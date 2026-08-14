import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AnimatedJadeMessageQr from './AnimatedJadeMessageQr';

const payload = `signmessage m/84h/0h/0h/0/0 ascii:${[
  'Bitcoin Access authentication request',
  'domain: example.com',
  'request_id: 123e4567-e89b-12d3-a456-426614174000',
  'address: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  'issued_at: 2026-08-14T12:34:56.000Z',
  'expires_at: 2026-08-14T12:44:56.000Z',
  'purpose: login',
].join('\n')}`;

test('renders a slow low-density Jade sequence with manual controls', () => {
  const { container } = render(<AnimatedJadeMessageQr payload={payload} />);
  const qr = container.querySelector('svg');

  // Uppercase alphanumeric BC-UR plus 30-byte fragments keeps this realistic
  // authentication request at QR version 4: 33 modules + a 4-module margin.
  expect(qr).toHaveAttribute('viewBox', '0 0 41 41');
  expect(screen.getByText(/1\.6s per frame/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next Jade QR frame' }));
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  expect(screen.getByText(/frame 2\//)).toBeInTheDocument();
});
