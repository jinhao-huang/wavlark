import { encodePath, readCatalog } from '#lib/catalog.js';

export const trailingSlash = 'ignore';

export async function load({ fetch, params }) {
  return { file: await readCatalog(fetch, '/api/resources/' + encodePath(params.path)) };
}
