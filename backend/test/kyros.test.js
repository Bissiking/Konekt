const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { afterEach, test } = require('node:test');
const {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeRefreshToken,
  resolveUser,
  verifyAccessToken,
} = require('../dist/kyros.js');

const originalFetch = global.fetch;

const config = {
  port: 3010,
  redirectUri: 'http://localhost:3010/auth/callback',
  sessionSecret: 'test-session-secret',
  kyros: {
    provider: 'kyros',
    ssoVersion: '4.4.0',
    edition: 'standard',
    applicationScope: 'standard',
    baseUrl: 'https://kyros.example.fr',
    authorizeUrl: 'https://kyros.example.fr/authorize',
    tokenUrl: 'https://kyros.example.fr/token',
    userinfoUrl: 'https://kyros.example.fr/userinfo',
    revokeUrl: 'https://kyros.example.fr/revoke',
    clientId: 'cli_konekt',
    clientSecret: 'client-secret',
    jwtSecret: 'jwt-secret',
    issuer: 'kyros',
    audience: 'kyros-modules',
    resourceAudience: 'kyros:sso:local-konekt',
    requestedScope: 'profile',
    requiredScopes: ['profile'],
    timeoutMs: 1000,
  },
};

function jwt(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'usr_test',
    username: 'test',
    iss: 'kyros',
    aud: ['kyros-modules'],
    resource_aud: 'kyros:sso:local-konekt',
    scope: 'profile',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })).toString('base64url');
  const signature = createHmac('sha256', config.kyros.jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

afterEach(() => { global.fetch = originalFetch; });

test('ajoute le handshake Kyros 4.4.0 à authorize', () => {
  const url = new URL(createAuthorizationUrl(config, 'state-test'));
  assert.equal(url.searchParams.get('kyros_sso_version'), '4.4.0');
  assert.equal(url.searchParams.get('kyros_edition'), 'standard');
  assert.equal(url.searchParams.get('kyros_application_scope'), 'standard');
});

test('ajoute le handshake à code, refresh et revoke', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ access_token: jwt(), refresh_token: 'next' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await exchangeAuthorizationCode(config, 'code');
  await refreshAccessToken(config, 'refresh');
  await revokeRefreshToken(config, 'refresh');

  assert.equal(requests.length, 3);
  for (const { body } of requests) {
    assert.equal(body.kyros_sso_version, '4.4.0');
    assert.equal(body.kyros_edition, 'standard');
    assert.equal(body.kyros_application_scope, 'standard');
  }
});

test('vérifie signature, issuer, audiences et scopes du JWT', () => {
  assert.equal(verifyAccessToken(config, jwt()).sub, 'usr_test');
  assert.throws(() => verifyAccessToken(config, jwt({ resource_aud: 'kyros:sso:other' })), /destiné à Konekt/);
  assert.throws(() => verifyAccessToken(config, `${jwt().slice(0, -1)}x`), /signature/);
});

test('reprend avatarUrl de Kyros et résout les chemins locaux', async () => {
  const absolute = await resolveUser(config, {
    access_token: jwt(),
    user: { id: 'usr_test', username: 'test', avatarUrl: 'https://kyros.example.fr/uploads/avatar.png' },
  });
  assert.equal(absolute.avatarUrl, 'https://kyros.example.fr/uploads/avatar.png');

  const relative = await resolveUser(config, {
    access_token: jwt({ avatar_url: '/assets/avatars/avatar-usr_test.png' }),
    user: { id: 'usr_test', username: 'test' },
  });
  assert.equal(relative.avatarUrl, 'https://kyros.example.fr/assets/avatars/avatar-usr_test.png');
});
