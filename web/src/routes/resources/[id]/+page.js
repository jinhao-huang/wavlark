import { readCatalog } from '#lib/catalog.js';

export async function load({ fetch, params }) {
  return { file: await readCatalog(fetch, '/api/resources/' + encodeURIComponent(params.id)) };
}
