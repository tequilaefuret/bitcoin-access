import { Buffer } from 'buffer';
import { decodeFirstJadeCbor, encodeJadeCbor } from './jadeCbor';
import {
  connectAndSignJadeAuthentication,
  JadeSerialRpc,
  relayJadeHttpRequest,
  validateJadeVersionInfo,
} from './jadeUsb';

test('validates that the selected serial device speaks the Jade protocol', () => {
  expect(validateJadeVersionInfo({ JADE_VERSION: '1.0.35', JADE_STATE: 'READY' }).JADE_STATE).toBe('READY');
  expect(() => validateJadeVersionInfo({ version: 'unknown' })).toThrow('valid Jade firmware');
});

test('relays only encrypted requests to the official Jade PIN server', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => '15' },
    text: async () => '{"data":"abc"}',
  });
  await expect(relayJadeHttpRequest({
    urls: ['https://j8d.io/get_pin', 'http://example.onion/get_pin'],
    method: 'POST',
    accept: 'json',
    data: { data: 'encrypted' },
  }, fetchImpl)).resolves.toEqual({ data: 'abc' });
  expect(fetchImpl).toHaveBeenCalledWith('https://j8d.io/get_pin', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ data: 'encrypted' }),
    credentials: 'omit',
  }));

  await expect(relayJadeHttpRequest({
    urls: ['https://127.0.0.1/private'],
    method: 'POST',
  }, fetchImpl)).rejects.toThrow('custom PIN server');
});

test('decodes fragmented replies and ignores Jade log messages', async () => {
  const log = encodeJadeCbor({ log: new Uint8Array([73, 32, 79, 75]) });
  const response = encodeJadeCbor({ id: 'web1', result: true });
  const chunks = [log.slice(0, 2), log.slice(2), response.slice(0, 3), response.slice(3)];
  const reader = { read: jest.fn(async () => ({ value: chunks.shift(), done: false })) };
  const writer = { write: jest.fn().mockResolvedValue(undefined) };
  const client = new JadeSerialRpc({});
  client.reader = reader;
  client.writer = writer;

  await expect(client.call('auth_user', { network: 'mainnet' })).resolves.toBe(true);
  expect(writer.write).toHaveBeenCalledTimes(1);
  expect(reader.read).toHaveBeenCalledTimes(4);
});

test('runs the bounded address-confirmation and message-signing USB sequence', async () => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'serial', { configurable: true, value: {} });
  const rawSignature = Buffer.concat([Buffer.from([32]), Buffer.alloc(64, 0x33)]).toString('base64');
  const replies = [
    { id: 'web1', result: { JADE_VERSION: '1.0.35', JADE_STATE: 'READY' } },
    { id: 'web2', result: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
    { id: 'web3', result: rawSignature },
  ].map(encodeJadeCbor);
  const reader = {
    read: jest.fn(async () => ({ value: replies.shift(), done: false })),
    cancel: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(),
  };
  const writes = [];
  const writer = {
    write: jest.fn(async (value) => writes.push(decodeFirstJadeCbor(value).value)),
    releaseLock: jest.fn(),
  };
  const port = {
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    readable: { getReader: () => reader },
    writable: { getWriter: () => writer },
  };

  const result = await connectAndSignJadeAuthentication({
    requestPort: async () => port,
    createSigningRequest: async ({ address }) => ({ message: `Sign in with ${address}` }),
  });

  expect(writes.map(({ method }) => method)).toEqual(['get_version_info', 'get_receive_address', 'sign_message']);
  expect(writes[1].params).toEqual(expect.objectContaining({
    network: 'mainnet',
    path: [0x80000054, 0x80000000, 0x80000000, 0, 0],
    variant: 'wpkh(k)',
  }));
  expect(Buffer.from(result.signature, 'base64')[0]).toBe(40);
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(port.close).toHaveBeenCalledTimes(1);
});
