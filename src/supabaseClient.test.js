import {
  clearJWT,
  changePassword,
  configurePassword,
  getJWT,
  loginWithPassword,
  logoutSession,
  requestAuthChallenge,
  restoreSession,
  skipPasswordSetup,
} from './supabaseClient';

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: jest.fn() },
    from: jest.fn(),
  }),
}));

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

const accessToken = [
  'header',
  btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })),
  'signature',
].join('.');

beforeEach(() => {
  clearJWT();
  localStorage.setItem('btc_auth_token', 'legacy-token');
  localStorage.setItem('bitcoin_address', 'bc1qlegacy');
  global.fetch = jest.fn();
});

afterEach(() => {
  clearJWT();
  localStorage.clear();
  jest.restoreAllMocks();
});

test('restores a server session without persisting authentication data', async () => {
  global.fetch.mockResolvedValue(jsonResponse({
    authenticated: true,
    address: 'bc1q-session-address',
    accessToken,
  }));

  await expect(restoreSession()).resolves.toEqual({ address: 'bc1q-session-address' });
  expect(getJWT()).toBe(accessToken);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/auth-session'),
    expect.objectContaining({ credentials: 'include' }),
  );
  expect(localStorage.getItem('btc_auth_token')).toBeNull();
  expect(localStorage.getItem('bitcoin_address')).toBeNull();
});

test('requests the exact authentication challenge from the server', async () => {
  const challenge = {
    requestId: '63f0ac29-8ac2-4e2f-b82f-909a1dcacfc3',
    challenge: 'server-issued-message',
  };
  global.fetch.mockResolvedValue(jsonResponse(challenge));

  await expect(requestAuthChallenge({
    address: 'bc1q-test-address',
    methodId: 'manual-signature',
  })).resolves.toEqual(challenge);

  const request = global.fetch.mock.calls[0][1];
  const body = JSON.parse(request.body);
  expect(body.address).toBe('bc1q-test-address');
  expect(body.methodId).toBe('manual-signature');
  expect(body).not.toHaveProperty('challenge');
});

test('logout revokes the cookie session and clears the in-memory token', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse({
      authenticated: true,
      address: 'bc1q-session-address',
      accessToken,
    }))
    .mockResolvedValueOnce(jsonResponse({ authenticated: false }));

  await restoreSession();
  await logoutSession();

  expect(getJWT()).toBeNull();
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ action: 'logout' });
});

test('signs in with a username and keeps the access token in memory only', async () => {
  global.fetch.mockResolvedValue(jsonResponse({
    authenticated: true,
    address: 'bc1q-password-address',
    accessToken,
  }));

  await expect(loginWithPassword('known-user', 'a long test password')).resolves.toEqual({
    address: 'bc1q-password-address',
  });

  expect(getJWT()).toBe(accessToken);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    action: 'login',
    identifier: 'known-user',
    password: 'a long test password',
  });
  expect(localStorage.getItem('btc_auth_token')).toBeNull();
  expect(localStorage.getItem('bitcoin_address')).toBeNull();
});

test('configures a password through the authenticated wallet session', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse({
      authenticated: true,
      address: 'bc1q-session-address',
      accessToken,
    }))
    .mockResolvedValueOnce(jsonResponse({
      configured: true,
      address: 'bc1q-session-address',
    }));

  await restoreSession();
  await expect(configurePassword('a different long password')).resolves.toEqual({
    configured: true,
    address: 'bc1q-session-address',
  });

  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    action: 'set',
    password: 'a different long password',
    accessToken,
  });
});

test('changes a password through the authenticated session', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse({
      authenticated: true,
      address: 'bc1q-session-address',
      accessToken,
    }))
    .mockResolvedValueOnce(jsonResponse({
      changed: true,
      address: 'bc1q-session-address',
    }));

  await restoreSession();
  await expect(changePassword('current long password', 'new different long password')).resolves.toEqual({
    changed: true,
    address: 'bc1q-session-address',
  });

  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    action: 'change',
    currentPassword: 'current long password',
    password: 'new different long password',
    accessToken,
  });
});

test('persists the choice to continue with wallet authentication only', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse({
      authenticated: true,
      address: 'bc1q-session-address',
      accessToken,
    }))
    .mockResolvedValueOnce(jsonResponse({
      skipped: true,
      address: 'bc1q-session-address',
    }));

  await restoreSession();
  await expect(skipPasswordSetup()).resolves.toEqual({
    skipped: true,
    address: 'bc1q-session-address',
  });

  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    action: 'skip',
    accessToken,
  });
});
