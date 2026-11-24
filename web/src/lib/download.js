import { downloadZip } from 'client-zip';

export async function prepareDownload(files, signal, onprogress) {
  const url = file => '/api/downloads/' + file.id;
  if (files.length > 40) throw new Error('Select up to 40 files per ZIP.');
  if (files.reduce((sum, file) => sum + file.size_bytes, 0) > 200 * 1024 ** 2) {
    throw new Error('Select up to 200 MiB per ZIP. Download larger selections in batches.');
  }
  const conflict = files.find(file => files.some(other => other.path.startsWith(file.path + '/')));
  if (conflict) throw new Error(`“${conflict.path}” is also a folder in this selection. Download that file separately.`);

  const params = new URLSearchParams(files.map(file => ['file', file.id]));
  const check = await fetch('/api/downloads?' + params, { signal, cache: 'no-store' });
  if (!check.ok) throw new Error('Could not check the selection. Please retry.');
  const missingIds = new Set((await check.json()).map(file => file.id));
  const missing = files.filter(file => missingIds.has(file.id));
  if (missing.length) return { missing };
  if (files.length === 1) return { url: url(files[0]) };

  async function* entries() {
    for (const [index, file] of files.entries()) {
      onprogress(`Preparing ZIP · ${index + 1} of ${files.length} · ${file.path}`);
      const response = await fetch(url(file), { signal, cache: 'no-store' });
      if (response.status === 404) {
        missing.push(file);
        return;
      }
      if (!response.ok) throw new Error(`Could not download “${file.path}”. Please retry.`);
      yield { name: file.path, input: response.body, lastModified: new Date(file.published_at * 1000) };
    }
  }
  const blob = await downloadZip(entries()).blob();
  signal.throwIfAborted();
  return missing.length ? { missing } : { blob };
}
