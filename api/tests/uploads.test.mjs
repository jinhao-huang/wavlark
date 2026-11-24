import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createTestHarness, experimental_readRawConfig } from 'wrangler';
import { startLocalAccess } from '../../dev/local-access.mjs';

test('upload, publish, delete and reuse file paths', async (t) => {
  const access = await startLocalAccess();
  t.after(() => access.server[Symbol.asyncDispose]());
  const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });
  const app = createTestHarness({ workers: [
    { configPath: '../web/.svelte-kit/cloudflare/worker/wrangler.json' },
    { config: {
      ...rawConfig,
      main: 'tests/r2-delete-failure.mjs',
      vars: { ...rawConfig.vars, ACCESS_ISSUER: access.issuer, ACCESS_AUD: access.audience }
    } }
  ] });
  t.after(() => app.close());
  const { url } = await app.listen();
  const api = app.getWorker('wavlark-api');
  await api.applyD1Migrations('DB');
  const { DB, FILES } = await api.getEnv();
  const token = await access.sign();
  const otherAdminEmail = 'colleague@example.com';
  const otherAdmin = await access.sign({ sub: 'colleague', email: otherAdminEmail });
  const name = '地图 100% #1?.pdf';
  const directory = '浙江/杭州';
  const path = directory + '/' + name;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const create = (fields = {}, jwt = token) => app.fetch('/api/manage/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt },
    body: JSON.stringify({ request_id: crypto.randomUUID(), name, directory, size_bytes: 5, description: 'A sample file', ...fields })
  });
  const manage = (id, action, method, jwt) => app.fetch(`/api/manage/resources/${id}/${action}`, {
    method, headers: { Origin: url.origin, 'Cf-Access-Jwt-Assertion': jwt }
  });
  const headers = { 'Cf-Access-Jwt-Assertion': otherAdmin };
  const draftList = async () => (await (await app.fetch('/api/manage/resources', { headers })).json()).drafts;
  const publish = (id, jwt = token) => manage(id, 'publication', 'PUT', jwt);
  const renew = (id, jwt = token) => manage(id, 'upload', 'POST', jwt);
  const discard = (id, jwt = token) => manage(id, 'upload', 'DELETE', jwt);
  const put = (ticket, body) => fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body });

  assert.equal((await create({}, '')).status, 401);
  assert.equal((await create({ size_bytes: 100 * 1024 * 1024 + 1 })).status, 413);
  for (const fields of [{ name: 'a/b' }, { directory: 'a//b' }, { directory: 'a/../b' }]) {
    assert.equal((await create(fields)).status, 400);
  }

  const reservations = await Promise.all([create(), create({ directory: '/' + directory + '/' })]);
  assert.deepEqual(reservations.map(r => r.status).sort(), [201, 409]);
  const upload = await reservations.find(r => r.status === 201).json();
  assert.equal(upload.path, path);
  assert.equal((await renew(upload.id, '')).status, 401);
  assert.equal((await publish(upload.id, '')).status, 401);
  assert.equal((await publish(upload.id)).status, 409);
  assert.equal(new URL(upload.url).searchParams.get('X-Amz-Expires'), '900');
  assert.ok(!(await put(upload, 'wrong length')).ok);

  const deadline = Math.floor(Date.now() / 1000) + 300;
  await DB.prepare('UPDATE resources SET expires_at = ? WHERE id = ?').bind(deadline, upload.id).run();
  const ticket = await (await renew(upload.id, otherAdmin)).json();
  assert.equal(ticket.id, upload.id);
  const ttl = Number(new URL(ticket.url).searchParams.get('X-Amz-Expires'));
  assert.ok(ttl > 0 && ttl <= 301);
  assert.equal(await DB.prepare('SELECT expires_at FROM resources WHERE id = ?').bind(upload.id).first('expires_at'), deadline);
  assert.equal((await put(ticket, 'hello')).status, 200);
  assert.equal((await put(ticket, 'other')).status, 412);
  assert.equal(await (await FILES.get(upload.id)).text(), 'hello');
  assert.deepEqual((await (await app.fetch('/api/resources')).json()).resources, []);
  for (const prefix of ['/api/resources/', '/download/']) {
    assert.equal((await app.fetch(prefix + encoded)).status, 404);
  }

  const attempt = { request_id: crypto.randomUUID(), directory: 'retry' };
  const first = await create(attempt);
  const retried = await create(attempt, otherAdmin);
  assert.equal(first.status, 201);
  assert.equal(retried.status, 200);
  assert.equal((await first.json()).id, (await retried.json()).id);
  assert.equal((await create({ ...attempt, size_bytes: 10 })).status, 409);

  const root = await (await create({ directory: '', size_bytes: 0 })).json();
  assert.equal(root.path, name);
  assert.notEqual(root.id, upload.id);
  assert.equal((await put(root, '')).status, 200);
  const missing = await (await create({ directory: 'empty' })).json();
  await FILES.put(missing.id, 'unexpected size');
  assert.equal((await publish(missing.id)).status, 422);

  assert.equal((await publish(upload.id, otherAdmin)).status, 204);
  assert.equal((await discard(upload.id)).status, 404);
  assert.equal((await publish(upload.id, otherAdmin)).status, 204);
  assert.equal((await renew(upload.id)).status, 409);
  assert.equal((await create()).status, 409);
  const catalog = await (await app.fetch('/api/resources')).json();
  assert.deepEqual(catalog.resources.map(file => file.path), [path]);
  const file = await (await app.fetch('/api/resources/' + encoded)).json();
  assert.equal(file.path, path);
  assert.equal(file.description, 'A sample file');
  const page = await app.fetch('/resources/' + encoded);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes(path));
  const download = await app.fetch('/download/' + encoded, { redirect: 'manual' });
  assert.equal(download.status, 200);
  assert.equal(decodeURIComponent(download.headers.get('Content-Disposition')), `attachment; filename*=UTF-8''${name}`);
  assert.equal(await download.text(), 'hello');

  const abandoned = await (await create({ directory: 'never-uploaded' })).json();
  await DB.prepare('UPDATE resources SET expires_at = 1 WHERE id IN (?, ?)').bind(missing.id, abandoned.id).run();
  assert.equal((await renew(missing.id)).status, 410);
  assert.equal((await publish(missing.id)).status, 410);
  assert.equal((await create({ directory: 'empty' })).status, 409);
  assert.ok(!(await draftList()).some(row => row.id === abandoned.id || row.id === missing.id));
  await api.scheduled({ cron: '*/5 * * * *' });
  assert.equal(await FILES.get(missing.id), null);
  assert.ok(await FILES.head(root.id));
  assert.ok(await FILES.head(upload.id));
  assert.equal((await renew(abandoned.id)).status, 404);
  const replacement = await create({ directory: 'empty' });
  assert.equal(replacement.status, 201);
  assert.notEqual((await replacement.json()).id, missing.id);

  // Finish an already authorized PUT after its expired draft was reclaimed.
  assert.equal((await put(abandoned, 'later')).status, 200);
  await FILES.put('unmanaged', 'keep');
  await api.scheduled({ cron: '0 3 * * *' });
  assert.equal(await FILES.head(abandoned.id), null);
  assert.ok(await FILES.head(upload.id));
  assert.ok(await FILES.head(root.id));
  assert.ok(await FILES.head('unmanaged'));

  const remove = (id, jwt = token) => app.fetch('/api/manage/resources/' + id, {
    method: 'DELETE', headers: { Origin: url.origin, 'Cf-Access-Jwt-Assertion': jwt }
  });
  const adminList = await (await app.fetch('/api/manage/resources', { headers })).json();
  assert.equal(adminList.email, otherAdminEmail);
  assert.deepEqual(adminList.resources, catalog.resources);
  assert.equal(catalog.resources[0].id, upload.id);
  assert.ok(!('email' in catalog));
  assert.ok(!('drafts' in catalog));
  const adminPage = await app.fetch('/manage', { headers });
  assert.ok((await adminPage.text()).includes(`aria-label="Delete ${path}"`));
  assert.equal((await remove(upload.id, '')).status, 401);
  assert.equal((await remove(root.id)).status, 204);
  assert.ok(await FILES.head(root.id)); // A draft has no published file to delete.
  assert.equal((await remove(upload.id, otherAdmin)).status, 204);
  assert.equal(await FILES.head(upload.id), null);
  for (const prefix of ['/resources/', '/api/resources/', '/download/']) {
    assert.equal((await app.fetch(prefix + encoded)).status, 404);
  }
  assert.deepEqual((await (await app.fetch('/api/manage/resources', { headers })).json()).resources, []);

  const next = await (await create({}, otherAdmin)).json();
  assert.notEqual(next.id, upload.id);
  assert.equal((await put(next, 'again')).status, 200);
  assert.equal((await publish(next.id)).status, 204);
  assert.equal((await remove(upload.id)).status, 204);
  const reusedLink = await app.fetch('/download/' + encoded, { redirect: 'manual' });
  assert.equal(await reusedLink.text(), 'again');

  for (const name of ['__data.json', 'index.html__route.js']) {
    const special = await (await create({ name, directory: '', size_bytes: 2 })).json();
    assert.equal((await put(special, 'ok')).status, 200);
    assert.equal((await publish(special.id)).status, 204);
    const home = await (await app.fetch('/')).text();
    const detailPath = '/resources/' + name + '/';
    assert.ok(home.includes(`href="${detailPath}"`));
    const detail = await app.fetch(detailPath, { redirect: 'manual' });
    assert.equal(detail.status, 200);
    assert.ok((await detail.text()).includes(`href="/download/${name}/"`));
    const response = await app.fetch('/download/' + name + '/', { redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  }
  const failedDelete = await app.fetch('/api/manage/resources/' + next.id, {
    method: 'DELETE', headers: { ...headers, Origin: url.origin, 'X-Test-Fail-R2-Delete': '1' }
  });
  assert.equal(failedDelete.status, 204);
  assert.equal(await DB.prepare('SELECT id FROM resources WHERE id = ?').bind(next.id).first(), null);
  assert.ok(await FILES.head(next.id));
  const finalFile = await (await create()).json();
  assert.equal((await put(finalFile, 'final')).status, 200);
  assert.equal((await publish(finalFile.id)).status, 204);
  await api.scheduled({ cron: '0 3 * * *' });
  assert.equal(await FILES.head(next.id), null);
  assert.equal((await remove(next.id)).status, 204);
  const latest = await app.fetch('/download/' + encoded, { redirect: 'manual' });
  assert.equal(await latest.text(), 'final');

  await t.test('download a selected version only while it is public', async () => {
    const download = id => app.fetch('/api/downloads/' + id, { redirect: 'manual' });
    assert.equal((await download(next.id)).status, 404);
    const draft = await (await create({ directory: '苏州' })).json();
    assert.equal((await put(draft, 'other')).status, 200);
    assert.equal((await download(draft.id)).status, 404);
    assert.equal((await publish(draft.id)).status, 204);
    const check = await app.fetch('/api/downloads/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([draft.id, next.id])
    });
    assert.deepEqual(await check.json(), [{ id: next.id }]);
    const file = await download(draft.id);
    assert.equal(file.headers.get('Cache-Control'), 'no-store');
    assert.equal(file.status, 200);
    assert.match(file.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(await file.text(), 'other');
    assert.equal((await remove(draft.id)).status, 204);
    assert.equal((await download(draft.id)).status, 404);
  });

  // Reopen a draft from another administrator's session after leaving the form.
  const draftFields = { directory: 'recovery' };
  const draft = await (await create(draftFields)).json();
  const recovered = (await draftList()).find(row => row.id === draft.id);
  assert.equal(recovered.path, draft.path);
  assert.equal(recovered.size_bytes, 5);
  assert.equal(recovered.description, 'A sample file');
  assert.ok(recovered.expires_at > Date.now() / 1000);
  assert.equal((await publish(draft.id, otherAdmin)).status, 409);
  const recoveredTicket = await (await renew(recovered.id, otherAdmin)).json();
  assert.equal((await put(recoveredTicket, 'draft')).status, 200);
  const reopened = await (await app.fetch('/manage', { headers })).text();
  assert.ok(reopened.includes('Unpublished drafts') && reopened.includes(draft.path));
  assert.equal((await discard(draft.id, '')).status, 401);
  assert.equal((await discard(draft.id, otherAdmin)).status, 204);
  assert.equal(await FILES.head(draft.id), null);
  assert.equal((await publish(draft.id)).status, 404);
  assert.ok(!(await draftList()).some(row => row.id === draft.id));

  const reused = await (await create(draftFields)).json();
  assert.notEqual(reused.id, draft.id);
  assert.equal((await put(reused, 'fresh')).status, 200);
  assert.equal((await publish(reused.id, otherAdmin)).status, 204);
  assert.equal((await discard(reused.id)).status, 404);
  assert.equal((await discard(draft.id)).status, 404);
  assert.equal((await put(recoveredTicket, 'later')).status, 200);
  await api.scheduled({ cron: '0 3 * * *' });
  assert.equal(await FILES.head(draft.id), null);
  assert.equal(await (await FILES.get(reused.id)).text(), 'fresh');

  const race = await (await create({ directory: 'two-admins' })).json();
  assert.equal((await put(race, 'hello')).status, 200);
  const [publication, removal] = await Promise.all([publish(race.id), discard(race.id, otherAdmin)]);
  if (publication.status === 204) {
    assert.equal(removal.status, 404);
    assert.equal(await (await FILES.get(race.id)).text(), 'hello');
    assert.equal((await app.fetch('/download/two-admins/' + encodeURIComponent(name), { redirect: 'manual' })).status, 200);
  } else {
    assert.ok([404, 409, 410].includes(publication.status));
    assert.equal(removal.status, 204);
    assert.equal(await FILES.head(race.id), null);
    assert.equal(await DB.prepare('SELECT id FROM resources WHERE id = ?').bind(race.id).first(), null);
  }

  await t.test('resume from acknowledged parts and publish by UUID', async () => {
    const partSize = 5 * 1024 ** 2;
    const body = Buffer.alloc(partSize + 1, 97);
    body[partSize] = 98;
    const sha256 = createHash('sha256').update(body).digest('hex');
    const fields = { name: 'large.bin', directory: '', size_bytes: body.length, sha256, request_id: crypto.randomUUID() };
    const control = (id, action, method, data, jwt = otherAdmin) => app.fetch(`/api/manage/resources/${id}/${action}`, {
      method, headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt },
      body: JSON.stringify(data)
    });
    const resume = (id, hash = sha256) => control(id, 'upload', 'POST', { sha256: hash });
    const ack = (ticket, etag) => control(ticket.id, 'upload/parts/' + ticket.number, 'PUT', { etag });
    const uploadPart = async (ticket) => {
      const response = await put(ticket, body.subarray(ticket.offset, ticket.offset + ticket.length));
      assert.equal(response.status, 200, await response.text());
      return response.headers.get('etag');
    };
    assert.equal((await create({ ...fields, sha256: undefined })).status, 400);
    const boundary = await (await create({ name: 'exact.bin', size_bytes: partSize })).json();
    assert.equal(boundary.offset, undefined);
    assert.equal((await put(boundary, body.subarray(0, partSize))).status, 200);
    assert.equal((await publish(boundary.id)).status, 204);
    const both = await Promise.all([create(fields), create(fields)]);
    assert.deepEqual(both.map(r => r.status).sort(), [200, 201]);
    const [first, replay] = await Promise.all(both.map(r => r.json()));
    assert.equal(new URL(first.url).searchParams.get('uploadId'), new URL(replay.url).searchParams.get('uploadId'));
    assert.equal((await control(first.id, 'upload/parts/1', 'PUT', { etag: 'abc' }, '')).status, 401);
    assert.equal(first.length, partSize);
    assert.equal(first.offset, 0);
    assert.equal((await resume(first.id, '0'.repeat(64))).status, 422);
    assert.ok(!(await put(first, 'bad size')).ok);
    const early = await ack({ ...first, number: 2 }, 'early');
    assert.equal(early.status, 409, await early.text());
    const etag = await uploadPart(first);
    // A lost upload response leaves this part eligible for retransmission.
    assert.equal((await (await resume(first.id)).json()).number, 1);
    const latest = await uploadPart(first);
    assert.ok(etag && latest);
    const second = await (await ack(first, latest)).json();
    assert.equal(second.number, 2);
    assert.equal(second.length, 1);
    assert.equal((await (await ack(first, latest)).json()).offset, partSize);
    assert.equal((await draftList()).find(d => d.id === first.id).uploaded_bytes, partSize);
    assert.equal((await publish(first.id)).status, 409);
    const recovered = await (await resume(first.id)).json();
    assert.equal(recovered.offset, partSize);
    const done = await (await ack(recovered, await uploadPart(recovered))).json();
    assert.equal(done.url, undefined);
    assert.equal(done.offset, body.length);
    assert.equal((await publish(first.id)).status, 204);
    assert.equal((await publish(first.id)).status, 204);
    const stored = await FILES.get(first.id);
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), body);
    assert.equal(stored.customMetadata.wavlark, 'upload');
    assert.ok(stored.httpMetadata.contentDisposition.includes(fields.name.replace('.', '%2E')));
    assert.equal((await discard(first.id)).status, 404);
    assert.equal((await ack(first, latest)).status, 409);
    assert.equal((await remove(first.id)).status, 204);

    // A concurrent PUT can replace a receipt before R2 assembles the object.
    const stale = await (await create(fields)).json();
    const last = await (await ack(stale, await uploadPart(stale))).json();
    await ack(last, await uploadPart(last));
    await uploadPart(stale);
    const conflict = await publish(stale.id);
    assert.equal(conflict.status, 409, await conflict.text());
    const retry = await (await resume(stale.id)).json();
    assert.equal(retry.offset, 0);
    const retryTag = await uploadPart(retry);
    const tail = await (await ack(retry, retryTag)).json();
    const tailTag = await uploadPart(tail);
    await ack(tail, tailTag);

    // Complete in R2 as if publication stopped before the D1 update.
    const session = FILES.resumeMultipartUpload(stale.id, new URL(retry.url).searchParams.get('uploadId'));
    await session.complete([retryTag, tailTag].map((tag, index) => ({ partNumber: index + 1, etag: tag.slice(1, -1) })));
    assert.equal((await publish(stale.id)).status, 204);
    assert.equal((await remove(stale.id)).status, 204);

    for (const expired of [false, true]) {
      const old = await (await create(fields)).json();
      await uploadPart(old);
      if (expired) {
        await DB.prepare('UPDATE resources SET expires_at = 1 WHERE id = ?').bind(old.id).run();
        assert.equal((await resume(old.id)).status, 410);
        await api.scheduled({ cron: '*/5 * * * *' });
      } else {
        assert.equal((await discard(old.id)).status, 204);
      }
      const fresh = await (await create(fields)).json();
      assert.notEqual(fresh.id, old.id);
      assert.ok(!(await put(old, body.subarray(0, partSize))).ok);
      assert.equal((await ack(old, latest)).status, 409);
      assert.equal((await publish(old.id)).status, 404);
      assert.equal((await discard(fresh.id)).status, 204);
    }
    // Drafts created by the previous deployment retain their write-once PUT.
    await DB.prepare("INSERT INTO resources (id,path,request_id,size_bytes,expires_at) VALUES ('legacy','old.bin','old',?,unixepoch()+3600)").bind(body.length).run();
    const legacy = await (await renew('legacy')).json();
    assert.equal(legacy.offset, undefined);
    assert.equal((await put(legacy, body)).status, 200);
    assert.equal((await publish('legacy')).status, 204);
  });
});
