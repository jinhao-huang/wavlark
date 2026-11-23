import { error } from '@sveltejs/kit';

export async function readCatalog(fetch, path) {
  const response = await fetch(path);
  if (!response.ok) {
    if (response.status === 404) error(404, 'File not found.');
    if (response.status === 400) error(400, 'Invalid page number.');
    error(503, 'The file library is unavailable. Please try again.');
  }
  return response.json();
}

export function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit++;
  }
  return `${Number(size.toFixed(1))} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
export const formatDate = (seconds) => dateFormat.format(seconds * 1000);
