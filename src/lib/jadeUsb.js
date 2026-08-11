import {
  appendJadeCborBytes,
  decodeFirstJadeCbor,
  encodeJadeCbor,
  IncompleteCborError,
} from './jadeCbor';
import {
  buildJadePathArray,
  normalizeJadeMessageSignature,
  validateJadeAddress,
} from './jadeValidation';

const SERIAL_BAUD_RATE = 115200;
const DEVICE_SELECTION_TIMEOUT_MS = 30_000;
const INTERACTION_TIMEOUT_MS = 300_000;
const MAX_SERIAL_BUFFER_BYTES = 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;
const MAX_HTTP_STEPS = 8;
const OFFICIAL_PIN_SERVER_HOSTS = new Set(['j8d.io', 'jadepin.blockstream.com']);

const withTimeout = (promise, timeoutMs, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

const describeSerialError = (error) => {
  const message = error?.message || '';
  if (/no port selected|cancel|notfounderror/i.test(message)) {
    return 'No Jade was selected. Connect it by USB and accept the browser device prompt.';
  }
  if (/networkerror|already open|in use|failed to open/i.test(message)) {
    return 'The Jade serial port is already in use. Close Blockstream Green or another wallet app, then try again.';
  }
  return message || 'Unable to communicate with Jade over USB.';
};

export function getJadeUsbAvailability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'Direct Jade connection requires a browser.' };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Direct Jade connection requires HTTPS or localhost.' };
  }
  if (!navigator.serial) {
    return {
      supported: false,
      reason: 'Use Chrome, Edge, Brave or Opera on a computer or compatible Android device. Safari and Firefox do not support Web Serial.',
    };
  }
  return { supported: true, reason: '' };
}

export function assertJadeUsbSupport() {
  const availability = getJadeUsbAvailability();
  if (!availability.supported) throw new Error(availability.reason);
}

export function validateJadeVersionInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The selected serial device did not identify itself as Jade.');
  }
  const version = value.JADE_VERSION;
  const state = value.JADE_STATE;
  if (typeof version !== 'string' || !version || typeof state !== 'string' || !state) {
    throw new Error('The selected serial device did not return valid Jade firmware information.');
  }
  return value;
}

const safePinServerUrl = (values) => {
  if (!Array.isArray(values)) throw new Error('Jade returned an invalid PIN-server URL list.');
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 256 || value.endsWith('.onion')) continue;
    try {
      const url = new URL(value);
      if (
        url.protocol === 'https:'
        && !url.username
        && !url.password
        && OFFICIAL_PIN_SERVER_HOSTS.has(url.hostname.toLowerCase())
      ) return url.toString();
    } catch {
      // Try the next URL supplied by Jade.
    }
  }
  throw new Error('This Jade uses a custom PIN server that the browser integration does not relay for security reasons. Unlock Jade separately, then try USB again.');
};

export async function relayJadeHttpRequest(params, fetchImpl = typeof fetch === 'function' ? fetch : null) {
  if (!params || typeof params !== 'object' || typeof fetchImpl !== 'function') {
    throw new Error('Jade returned an invalid PIN-server request.');
  }
  const url = safePinServerUrl(params.urls);
  const method = String(params.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('Jade requested an unsupported PIN-server method.');
  const acceptsJson = ['json', 'application/json'].includes(String(params.accept || '').toLowerCase());
  if (method === 'GET' && params.data !== undefined) throw new Error('Jade returned an invalid PIN-server GET request.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      body: method === 'POST'
        ? (acceptsJson ? JSON.stringify(params.data ?? null) : params.data)
        : undefined,
      headers: method === 'POST' && acceptsJson ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The Jade PIN server did not respond in time.');
    throw new Error('The encrypted Jade PIN-server relay failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`The Jade PIN server returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_HTTP_RESPONSE_BYTES) throw new Error('The Jade PIN-server response is too large.');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_HTTP_RESPONSE_BYTES) {
    throw new Error('The Jade PIN-server response is too large.');
  }
  if (!acceptsJson) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The Jade PIN server returned invalid JSON.');
  }
}

export class JadeSerialRpc {
  constructor(port) {
    this.port = port;
    this.reader = null;
    this.writer = null;
    this.buffer = new Uint8Array();
    this.requestCounter = 0;
  }

  async open() {
    await this.port.open({ baudRate: SERIAL_BAUD_RATE, bufferSize: 4096 });
    if (!this.port.readable || !this.port.writable) throw new Error('The selected serial port cannot communicate with Jade.');
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
  }

  async readMessage(timeoutMs = INTERACTION_TIMEOUT_MS) {
    while (true) {
      if (this.buffer.length) {
        try {
          const decoded = decodeFirstJadeCbor(this.buffer);
          this.buffer = this.buffer.slice(decoded.bytesRead);
          if (decoded.value && typeof decoded.value === 'object' && 'log' in decoded.value && !('id' in decoded.value)) {
            continue;
          }
          return decoded.value;
        } catch (error) {
          if (!(error instanceof IncompleteCborError)) throw error;
        }
      }

      const chunk = await withTimeout(
        this.reader.read(),
        timeoutMs,
        'Jade did not respond in time. Reconnect it and try again.',
      );
      if (chunk.done) throw new Error('The Jade USB connection ended before a reply was received.');
      if (!chunk.value?.length) continue;
      this.buffer = appendJadeCborBytes(this.buffer, chunk.value);
      if (this.buffer.length > MAX_SERIAL_BUFFER_BYTES) throw new Error('Jade returned more data than expected.');
    }
  }

  async call(method, params, timeoutMs = INTERACTION_TIMEOUT_MS) {
    if (!this.writer || !this.reader) throw new Error('The Jade serial connection is not open.');
    if (typeof method !== 'string' || !/^[a-z_]{1,32}$/.test(method)) throw new Error('Invalid Jade RPC method.');
    this.requestCounter += 1;
    const id = `web${this.requestCounter}`;
    const request = params === undefined ? { id, method } : { id, method, params };
    await this.writer.write(encodeJadeCbor(request));
    const reply = await this.readMessage(timeoutMs);
    if (!reply || typeof reply !== 'object' || reply.id !== id) {
      throw new Error('Jade returned a reply that does not match the request.');
    }
    if (('result' in reply) === ('error' in reply)) throw new Error('Jade returned a malformed RPC reply.');
    if (reply.error) {
      const message = typeof reply.error.message === 'string' ? reply.error.message : 'Jade rejected the request.';
      throw new Error(message);
    }
    return reply.result;
  }

  async callWithHttp(method, params, { fetchImpl = typeof fetch === 'function' ? fetch : null, onStatus } = {}) {
    let nextMethod = method;
    let nextParams = params;
    for (let step = 0; step < MAX_HTTP_STEPS; step += 1) {
      const result = await this.call(nextMethod, nextParams);
      const request = result?.http_request;
      if (!request) return result;
      if (typeof request['on-reply'] !== 'string' || !request.params) {
        throw new Error('Jade returned an invalid PIN-server relay request.');
      }
      onStatus?.('Relaying Jade’s encrypted PIN request. Your PIN never leaves the device.');
      nextParams = await relayJadeHttpRequest(request.params, fetchImpl);
      nextMethod = request['on-reply'];
    }
    throw new Error('Jade requested too many PIN-server relay steps.');
  }

  async close() {
    try { await this.reader?.cancel(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    this.reader = null;
    this.writer = null;
    try { await this.port?.close(); } catch {}
  }
}

export async function connectAndSignJadeAuthentication({
  account = 0,
  branch = 0,
  index = 0,
  createSigningRequest,
  onStatus,
  requestPort = () => navigator.serial.requestPort(),
  fetchImpl = typeof fetch === 'function' ? fetch : null,
}) {
  assertJadeUsbSupport();
  if (typeof createSigningRequest !== 'function') throw new Error('The Jade authentication request builder is unavailable.');
  const path = buildJadePathArray({ account, branch, index });
  let client;

  try {
    onStatus?.('Select Blockstream Jade in the browser device window.');
    const port = await withTimeout(
      requestPort(),
      DEVICE_SELECTION_TIMEOUT_MS,
      'No Jade was selected before the device prompt expired.',
    );
    client = new JadeSerialRpc(port);
    await client.open();
    onStatus?.('Checking the connected Jade firmware.');
    const versionInfo = validateJadeVersionInfo(await client.call('get_version_info', undefined, 30_000));

    if (versionInfo.JADE_STATE === 'UNINIT') {
      throw new Error('This Jade is not initialized. Set it up independently before using it to sign in.');
    }
    if (!['READY', 'LOCKED', 'TEMP', 'UNSAVED'].includes(versionInfo.JADE_STATE)) {
      throw new Error('Jade returned an unsupported wallet state. Update or restart the device, then try again.');
    }
    if (versionInfo.JADE_STATE === 'LOCKED') {
      onStatus?.('Enter your PIN only on Jade to unlock it.');
      const authenticated = await client.callWithHttp('auth_user', {
        network: 'mainnet',
        epoch: Math.floor(Date.now() / 1000),
      }, { fetchImpl, onStatus });
      if (authenticated !== true) throw new Error('Jade was not unlocked. Confirm the PIN on the device and try again.');
    }

    onStatus?.('Verify and approve the Bitcoin address shown on Jade.');
    const address = validateJadeAddress(await client.call('get_receive_address', {
      network: 'mainnet',
      path,
      variant: 'wpkh(k)',
    }));
    const request = await createSigningRequest({ address, path, versionInfo });
    if (typeof request?.message !== 'string' || !request.message.trim()) {
      throw new Error('The Jade authentication challenge is missing.');
    }

    onStatus?.('Review and approve the login message on Jade.');
    const signature = normalizeJadeMessageSignature(await client.call('sign_message', {
      path,
      message: request.message,
    }));
    return { address, path, signature, versionInfo };
  } catch (error) {
    throw new Error(describeSerialError(error));
  } finally {
    await client?.close();
  }
}
