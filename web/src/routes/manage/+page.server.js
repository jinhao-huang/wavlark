import { error } from '@sveltejs/kit';

export async function load({ fetch, request, setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const response = await fetch('/api/manage/me', {
    credentials: 'omit',
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {}
  });
  if (response.status === 401) error(401, await response.text());
  if (!response.ok) error(503, 'Publisher access is unavailable. Please try again.');
  const { email } = await response.json();
  return { email };
}
