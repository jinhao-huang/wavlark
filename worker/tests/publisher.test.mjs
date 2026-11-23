import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createTestHarness } from 'wrangler';

test('publisher access through the web and API Workers', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' };
  let keysAvailable = false;
  const certs = createServer((req, res) => {
    if (req.url !== '/cdn-cgi/access/certs') return res.writeHead(404).end();
    if (!keysAvailable) return res.writeHead(503).end();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
  });
  certs.listen(0, '127.0.0.1');
  await once(certs, 'listening');
  t.after(() => certs.close());
  const issuer = `http://127.0.0.1:${certs.address().port}`;
  const audience = 'publisher-test';

  const app = createTestHarness({ workers: [
    { configPath: '../web/.svelte-kit/cloudflare/worker/wrangler.json' },
    { configPath: 'wrangler.jsonc', vars: { ACCESS_ISSUER: issuer, ACCESS_AUD: audience } }
  ] });
  t.after(() => app.close());
  await app.listen();
  const claims = {
    iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 300,
    type: 'app', sub: 'publisher-a', email: 'publisher@example.com'
  };
  function sign(overrides = {}, key = privateKey) {
    return new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key);
  }
  const headers = { 'Cf-Access-Jwt-Assertion': await sign() };
  assert.equal((await app.fetch('/manage', { headers })).status, 503);
  keysAvailable = true;
  const api = await app.fetch('/api/manage/me', { headers });
  assert.equal(api.status, 200);
  assert.equal(api.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await api.json(), { id: claims.sub, email: claims.email });
  const page = await app.fetch('/manage', { headers });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.ok((await page.text()).includes(claims.email));

  for (const path of ['/manage', '/api/manage/me']) {
    const anonymous = await app.fetch(path, { headers: { 'Cf-Access-Authenticated-User-Email': claims.email } });
    assert.equal(anonymous.status, 401, path);
    assert.ok(!(await anonymous.text()).includes(claims.email));
  }
  for (const overrides of [
    { iss: 'https://another.example' }, { aud: ['another-app'] }, { exp: 1 },
    { exp: undefined }, { nbf: claims.exp }, { type: 'org' }, { sub: '' }, { email: undefined }
  ]) {
    const response = await app.fetch('/api/manage/me', {
      headers: { 'Cf-Access-Jwt-Assertion': await sign(overrides) }
    });
    assert.equal(response.status, 401, JSON.stringify(overrides));
  }
  const other = await generateKeyPair('RS256');
  const invalidSignature = await app.fetch('/manage', {
    headers: { 'Cf-Access-Jwt-Assertion': await sign({}, other.privateKey) }
  });
  assert.equal(invalidSignature.status, 401);
  assert.equal((await app.fetch('/api/health')).status, 200);
});
