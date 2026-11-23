import { env } from 'cloudflare:workers';

export function handle({ event, resolve }) {
  const path = event.url.pathname;
  if (path.startsWith('/api/') || path.startsWith('/download/')) {
    return env.API.fetch(event.request, { redirect: 'manual' });
  }
  return resolve(event);
}
