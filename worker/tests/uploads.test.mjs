import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestHarness } from 'wrangler';
import { startLocalAccess } from '../../dev/local-access.mjs';

test('private file uploads through the publisher API', async (t) => {
  const access = await startLocalAccess();
  t.after(() => access.server[Symbol.asyncDispose]());
  const app = createTestHarness({ workers: [
    { configPath: '../web/.svelte-kit/cloudflare/worker/wrangler.json' },
    { configPath: 'wrangler.jsonc', vars: { ACCESS_ISSUER: access.issuer, ACCESS_AUD: access.audience } }
  ] });
  t.after(() => app.close());
  await app.listen();
  await app.getWorker('wavlark-api').applyD1Migrations('DB');
  const token = await access.sign();
  const name = '示例 (1).txt';
  const create = (size, jwt = token) => app.fetch('/api/manage/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt },
    body: JSON.stringify({ name, size_bytes: size, description: 'A sample file' })
  });
  assert.equal((await create(5, '')).status, 401);
  assert.equal((await create(100 * 1024 * 1024 + 1)).status, 413);

  const response = await create(5);
  assert.equal(response.status, 201, await response.clone().text());
  const upload = await response.json();
  const put = (body) => fetch(upload.url, { method: 'PUT', headers: upload.headers, body });
  assert.ok(!(await put('wrong length')).ok);
  assert.equal((await put('hello')).status, 200);
  assert.equal((await put('other')).status, 412);
  const second = await (await create(0)).json();
  assert.notEqual(second.id, upload.id);
  assert.equal((await fetch(second.url, { method: 'PUT', headers: second.headers, body: '' })).status, 200);
  const { FILES } = await app.getWorker('wavlark-api').getEnv();
  assert.equal(await (await FILES.get(upload.id)).text(), 'hello');
  assert.deepEqual((await (await app.fetch('/api/resources')).json()).resources, []);
  for (const path of [`/api/resources/${upload.id}`, `/download/${upload.id}`]) {
    assert.equal((await app.fetch(path)).status, 404);
  }
});
