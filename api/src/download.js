// A missing range requests the whole file. A zero-length range is unsatisfiable.
function requestedRange(headers, size, etag) {
  const validator = headers.get('If-Range');
  if (validator && validator !== etag) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(headers.get('Range') ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return { offset, length: Math.max(0, end - offset + 1) };
}

function pacedBody(source, length, bytesPerSecond) {
  const { readable, writable } = new FixedLengthStream(length);
  const reader = source.getReader({ mode: 'byob' });
  const writer = writable.getWriter();
  // Batch reads so a large transfer doesn't run JS for every network packet.
  const batch = Math.min(length, 1024 * 1024, Math.max(1, Math.floor(bytesPerSecond / 4)));
  async function pump() {
    try {
      let buffer = new ArrayBuffer(batch);
      while (true) {
        const start = Date.now();
        const { value, done } = await reader.readAtLeast(batch, new Uint8Array(buffer));
        if (done) break;
        const delay = Math.ceil(value.byteLength * 1000 / bytesPerSecond) - (Date.now() - start);
        if (delay > 0) await scheduler.wait(delay);
        await writer.write(value);
        buffer = value.buffer;
      }
      await writer.close();
    } catch (error) {
      await Promise.allSettled([reader.cancel(error), writer.abort(error)]);
    }
  }
  void pump();
  return readable;
}

export async function sendDownload(request, env, identifier, byId, admin) {
  const column = byId ? 'id' : 'path';
  const rate = admin ? 'admin_mbps' : 'public_mbps';
  const file = await env.DB.prepare(
    `SELECT f.id, f.size_bytes, s.${rate} AS mbps FROM published_resources f
     CROSS JOIN download_settings s WHERE f.${column} = ? AND s.id = 1`
  ).bind(identifier).first();
  if (!file) return new Response('File not found.', { status: 404 });

  // Published objects are immutable. Replacing a public path creates a new ID.
  const etag = `"${file.id}"`;
  const head = request.method === 'HEAD';
  const range = head ? null : requestedRange(request.headers, file.size_bytes, etag);
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ETag: etag });
  if (range?.length === 0) {
    headers.set('Content-Range', `bytes */${file.size_bytes}`);
    return new Response(null, { status: 416, headers });
  }
  const object = head ? await env.FILES.head(file.id)
    : await env.FILES.get(file.id, range ? { range } : undefined);
  if (!object) return new Response('File not found.', { status: 404 });

  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'no-store');
  const length = range?.length ?? object.size;
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + length - 1}/${object.size}`);
  let body = head ? null : object.body;
  if (body && length && file.mbps) body = pacedBody(body, length, file.mbps * 1_000_000);
  return new Response(body, { status: range ? 206 : 200, headers });
}
