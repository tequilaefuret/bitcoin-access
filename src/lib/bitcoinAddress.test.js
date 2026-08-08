import { normalizeBitcoinAddress } from './bitcoinAddress';

const TAPROOT_ADDRESS = 'bc1pph976pj97qn2sduxjr6nd6eqylg2k746n7n6lf67qtqpfn6f4apqy9dnq5';

test('keeps a plain Taproot address', () => {
  expect(normalizeBitcoinAddress(TAPROOT_ADDRESS)).toBe(TAPROOT_ADDRESS);
});

test('extracts an address from a Reown CAIP-10 account', () => {
  expect(normalizeBitcoinAddress(
    `bip122:000000000019d6689c085ae165831e93:${TAPROOT_ADDRESS}`
  )).toBe(TAPROOT_ADDRESS);
});

test('extracts an address from a Bitcoin URI', () => {
  expect(normalizeBitcoinAddress(`bitcoin:${TAPROOT_ADDRESS}?amount=0.1`)).toBe(TAPROOT_ADDRESS);
});
