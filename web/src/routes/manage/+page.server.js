import { readCatalog } from '#lib/catalog.js';

export function load({ fetch, request, setHeaders, url }) {
  setHeaders({ 'cache-control': 'no-store' });
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const page = url.searchParams.get('page') ?? '1';
  return readCatalog(fetch, `/api/manage/resources?page=${encodeURIComponent(page)}`, {
    credentials: 'omit',
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {}
  });
}
