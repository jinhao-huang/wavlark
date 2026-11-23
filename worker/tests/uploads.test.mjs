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
  const { url } = await app.listen();
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

  const publish = (id, jwt = token) => app.fetch(`/api/manage/resources/${id}/publication`, {
    method: 'PUT', headers: { Origin: url.origin, 'Cf-Access-Jwt-Assertion': jwt }
  });
  const missing = await (await create(1)).json();
  assert.equal((await publish(missing.id)).status, 409);
  await FILES.put(missing.id, 'unexpected size');
  assert.equal((await publish(missing.id)).status, 409);
  const otherPublisher = await access.sign({ sub: 'another-publisher' });
  assert.equal((await publish(upload.id, otherPublisher)).status, 404);
  assert.equal((await publish(upload.id, '')).status, 401);
  assert.equal((await publish(upload.id)).status, 204);
  assert.equal((await publish(upload.id)).status, 204);
  const catalog = await (await app.fetch('/api/resources')).json();
  assert.deepEqual(catalog.resources.map(({ id }) => id), [upload.id]);
  const file = await (await app.fetch(`/api/resources/${upload.id}`)).json();
  assert.equal(file.name, name);
  assert.equal(file.description, 'A sample file');
  const download = await app.fetch(`/download/${upload.id}`, { redirect: 'manual' });
  assert.equal(download.status, 302);
  const object = await fetch(download.headers.get('Location'));
  const disposition = decodeURIComponent(object.headers.get('Content-Disposition'));
  assert.equal(disposition, `attachment; filename*=UTF-8''${name}`);
  assert.equal(await object.text(), 'hello');
});
