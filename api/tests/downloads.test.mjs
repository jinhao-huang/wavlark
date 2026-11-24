import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDownload } from '../../web/src/lib/download.js';

test('prepare a complete ZIP from the selected publications', async t => {
  const files = ['杭州/maps.txt', '苏州/maps.txt'].map((path, id) =>
    ({ id: String(id), path, size_bytes: id, published_at: 1_800_000_000 }));
  const read = t.mock.method(globalThis, 'fetch', async url =>
    url.includes('?') ? Response.json([]) : new Response(url.endsWith('/0') ? '' : 'B'));
  const prepare = files => prepareDownload(files, new AbortController().signal, () => {});

  await assert.rejects(prepare(Array(41).fill(files[0])), /40 files/);
  await assert.rejects(prepare([{ ...files[0], size_bytes: 200 * 1024 ** 2 }, files[1]]), /200 MiB/);
  await assert.rejects(prepare([files[0], { ...files[1], path: '杭州' }]), /also a folder/);
  assert.equal(read.mock.callCount(), 0);

  const { blob } = await prepare(files);
  const bytes = Buffer.from(await blob.arrayBuffer());
  // Walk the ZIP directory and verify each entry's name and stored bytes.
  let offset = bytes.readUInt32LE(bytes.length - 6);
  for (const file of files) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    assert.equal(bytes.toString('utf8', offset + 46, offset + 46 + nameLength), file.path);
    const start = bytes.readUInt32LE(offset + 42) + 30 + nameLength;
    const size = bytes.readUInt32LE(offset + 24);
    assert.equal(bytes.toString('utf8', start, start + size), file.id === '1' ? 'B' : '');
    offset += 46 + nameLength;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x06054b50);

  const calls = read.mock.callCount();
  read.mock.mockImplementationOnce(async () => Response.json([{ id: files[0].id }]));
  assert.deepEqual(await prepare(files), { missing: [files[0]] });
  assert.equal(read.mock.callCount(), calls + 1);

  read.mock.mockImplementation(async url =>
    url.includes('?') ? Response.json([]) : new Response(null, { status: 404 }));
  assert.deepEqual(await prepare(files), { missing: [files[0]] });
  assert.equal(read.mock.callCount(), calls + 3);
  read.mock.mockImplementation(async url =>
    url.includes('?') ? Response.json([]) : new Response(null, { status: 503 }));
  await assert.rejects(prepare(files), /Could not download/);
});
