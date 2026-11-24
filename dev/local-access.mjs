import { once } from 'node:events';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function startLocalAccess() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const header = { alg: 'RS256', kid: 'local-admin' };
  const keys = JSON.stringify({ keys: [{ ...await exportJWK(publicKey), ...header }] });
  const server = createServer((req, res) => {
    if (req.url !== '/cdn-cgi/access/certs') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(keys);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.unref();
  const issuer = `http://127.0.0.1:${server.address().port}`;
  const audience = 'wavlark-local';

  function sign(overrides = {}, key = privateKey) {
    return new SignJWT({
      iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 300,
      type: 'app', sub: 'local-admin', email: 'admin@example.com', ...overrides
    }).setProtectedHeader(header).sign(key);
  }

  return { issuer, audience, sign, server };
}
