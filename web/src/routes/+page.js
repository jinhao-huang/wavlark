import { readCatalog } from '#lib/catalog.js';

export function load({ fetch, url }) {
  const page = url.searchParams.get('page') ?? '1';
  return readCatalog(fetch, `/api/resources?page=${encodeURIComponent(page)}`);
}
