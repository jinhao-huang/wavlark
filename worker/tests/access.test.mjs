import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { generateKeyPair } from 'jose';
import { createTestHarness } from 'wrangler';
import { startLocalAccess } from '../../dev/local-access.mjs';

test('admin access through the web and API Workers', async (t) => {
  const { issuer, audience, sign, server } = await startLocalAccess();
  t.after(() => server[Symbol.asyncDispose]());

  const app = createTestHarness({ workers: [
    { configPath: '../web/.svelte-kit/cloudflare/worker/wrangler.json' },
    { configPath: 'wrangler.jsonc', vars: { ACCESS_ISSUER: issuer, ACCESS_AUD: audience } }
  ] });
  t.after(() => app.close());
  await app.listen();
  const email = 'admin@example.com';
  const headers = { 'Cf-Access-Jwt-Assertion': await sign() };
  const address = server.address();
  await server[Symbol.asyncDispose]();
  assert.equal((await app.fetch('/manage', { headers })).status, 503);
  server.listen(address.port, address.address);
  await once(server, 'listening');
  const api = await app.fetch('/api/manage/me', { headers });
  assert.equal(api.status, 200);
  assert.equal(api.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await api.json(), { email });
  const page = await app.fetch('/manage', { headers });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.ok((await page.text()).includes(email));

  for (const path of ['/manage', '/api/manage/me']) {
    const anonymous = await app.fetch(path, { headers: { 'Cf-Access-Authenticated-User-Email': email } });
    assert.equal(anonymous.status, 401, path);
    assert.ok(!(await anonymous.text()).includes(email));
  }
  for (const overrides of [
    { iss: 'https://another.example' }, { aud: ['another-app'] }, { exp: 1 },
    { exp: undefined }, { nbf: Math.ceil(Date.now() / 1000) + 300 }, { type: 'org' }, { sub: '' }, { email: undefined }, { email: '' }
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
