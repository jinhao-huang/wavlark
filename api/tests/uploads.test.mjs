import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  assert.equal(download.status, 302);
  const object = await fetch(download.headers.get('Location'));
  assert.equal(decodeURIComponent(object.headers.get('Content-Disposition')), `attachment; filename*=UTF-8''${name}`);
  assert.equal(await object.text(), 'hello');

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
  assert.deepEqual(adminList.resources, [{ ...catalog.resources[0], id: upload.id }]);
  assert.ok(!('id' in catalog.resources[0]));
  assert.ok(!('email' in catalog));
  assert.ok(!('drafts' in catalog));
  const adminPage = await app.fetch('/manage', { headers });
  assert.ok((await adminPage.text()).includes(`aria-label="Delete ${path}"`));
  assert.equal((await remove(upload.id, '')).status, 401);
  assert.equal((await remove(root.id)).status, 204);
  assert.ok(await FILES.head(root.id)); // A draft has no published file to delete.
  assert.equal((await remove(upload.id, otherAdmin)).status, 204);
  assert.equal(await FILES.head(upload.id), null);
  assert.equal((await fetch(download.headers.get('Location'))).status, 404);
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
  assert.equal(await (await fetch(reusedLink.headers.get('Location'))).text(), 'again');

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
    const redirect = await app.fetch('/download/' + name + '/', { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(await (await fetch(redirect.headers.get('Location'))).text(), 'ok');
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
  assert.equal(await (await fetch(latest.headers.get('Location'))).text(), 'final');

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
    assert.equal((await app.fetch('/download/two-admins/' + encodeURIComponent(name), { redirect: 'manual' })).status, 302);
  } else {
    assert.ok([404, 409, 410].includes(publication.status));
    assert.equal(removal.status, 204);
    assert.equal(await FILES.head(race.id), null);
    assert.equal(await DB.prepare('SELECT id FROM resources WHERE id = ?').bind(race.id).first(), null);
  }
});
