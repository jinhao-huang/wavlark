import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestHarness } from 'wrangler';
import { startLocalAccess } from '../../dev/local-access.mjs';

test('public and admin downloads use independent per-transfer speeds and resume safely', async t => {
  const access = await startLocalAccess();
  t.after(() => access.server[Symbol.asyncDispose]());
  const app = createTestHarness({ workers: [
    { configPath: '../web/.svelte-kit/cloudflare/worker/wrangler.json' },
    { configPath: 'wrangler.jsonc', vars: { ACCESS_ISSUER: access.issuer, ACCESS_AUD: access.audience } }
  ] });
  t.after(() => app.close());
  const { url } = await app.listen();
  const api = app.getWorker('wavlark-api');
  await api.applyD1Migrations('DB');
  const { DB, FILES } = await api.getEnv();
  const admin = { 'Cf-Access-Jwt-Assertion': await access.sign() };
  const fetchFile = (path, options) => fetch(new URL(path, url), { redirect: 'manual', ...options });
  const settings = (public_mbps, admin_mbps, headers = admin) => fetchFile('/api/manage/download-settings', {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_mbps, admin_mbps })
  });
  const id = crypto.randomUUID();
  const byPath = '/download/sample.bin';
  const byId = '/api/downloads/' + id;
  const adminPath = '/api/manage/resources/' + id + '/download';
  const bytes = Buffer.from(Array.from({ length: 120_000 }, (_, i) => i % 251));
  await FILES.put(id, bytes, { httpMetadata: { contentType: 'application/octet-stream', contentDisposition: 'attachment; filename="sample.bin"' } });
  await DB.prepare('INSERT INTO resources(id, path, size_bytes, request_id, published_at) VALUES (?, ?, ?, ?, 1)')
    .bind(id, 'sample.bin', bytes.length, id).run();

  assert.equal((await fetchFile(adminPath)).status, 401);
  assert.equal((await settings(0, 0, {})).status, 401);
  assert.equal((await settings(0.12, -1)).status, 400);
  assert.equal((await settings(0.12, 0.24)).status, 204);
  const config = await (await fetchFile('/api/manage/resources', { headers: admin })).json();
  assert.deepEqual(config.download_settings, { public_mbps: 0.12, admin_mbps: 0.24 });
  const page = await (await fetchFile('/resources/sample.bin')).text();
  assert.match(page, /0\.12 MB\/s per download/);

  async function timedDownload(path, headers) {
    const started = performance.now();
    const response = await fetchFile(path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), String(bytes.length), JSON.stringify(Object.fromEntries(response.headers)));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    return performance.now() - started;
  }
  // Simultaneous requests keep their own rate, even with an admin token on a public URL.
  const [ordinary, batchFile, administrator] = await Promise.all([
    timedDownload(byPath, admin), timedDownload(byId), timedDownload(adminPath, admin)
  ]);
  assert.ok(ordinary >= 950 && batchFile >= 950 && administrator >= 475,
    `Elapsed milliseconds: path=${ordinary}, id=${batchFile}, admin=${administrator}`);
  assert.ok(administrator < ordinary, 'the faster admin download should finish first');
  assert.equal((await settings(0, 0)).status, 204);
  const head = await fetchFile(byPath, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const etag = head.headers.get('etag');
  assert.equal(etag, `"${id}"`);
  const tail = await fetchFile(byPath, { headers: { Range: 'bytes=100000-', 'If-Range': etag } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), 'bytes 100000-119999/120000');
  assert.equal(tail.headers.get('content-length'), '20000');
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(100000));
  const suffix = await fetchFile(byId, { headers: { Range: 'bytes=-123' } });
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-123));
  const invalid = await fetchFile(byId, { headers: { Range: 'bytes=120000-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */120000');
  const replaced = await fetchFile(byPath, { headers: { Range: 'bytes=100000-', 'If-Range': '"older-file"' } });
  assert.equal(replaced.status, 200);
  assert.deepEqual(Buffer.from(await replaced.arrayBuffer()), bytes);
});
