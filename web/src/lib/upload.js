const resources = '/api/manage/resources';

async function ticket(path, method, data) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if ([400, 404, 409, 410, 413, 422].includes(response.status)) {
      throw new Error(await response.text(), { cause: response.status });
    }
    throw new Error('Could not confirm upload progress. Check your sign-in and retry.');
  }
  return response.json();
}

export function requestUpload(file, directory, description, requestId, draftId, sha256) {
  return draftId
    ? ticket(`${resources}/${draftId}/upload`, 'POST', { sha256 })
    : ticket(resources, 'POST', {
        request_id: requestId, name: file.name, size_bytes: file.size, directory, description, sha256
      });
}

function put(upload, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.url);
    for (const [name, value] of Object.entries(upload.headers ?? {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = ({ loaded }) => onProgress(loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
      else if (!upload.number && xhr.status === 412) resolve(null);
      else if (xhr.status === 403) reject(new Error('Upload authorization expired or failed. Retry to get a new link.'));
      else reject(new Error('Upload failed. Please retry.'));
    };
    xhr.onerror = () => reject(new Error('Connection interrupted. Please retry.'));
    xhr.send(body);
  });
}

export async function sendFile(upload, file, onProgress) {
  if (upload.offset === undefined) return !!(await put(upload, file, onProgress));
  while (upload.url) {
    const { offset, length, number } = upload;
    onProgress(offset);
    const response = await put(upload, file.slice(offset, offset + length), (n) => onProgress(offset + n));
    const etag = response.getResponseHeader('ETag');
    if (!etag) throw new Error('R2 did not expose the part ETag. Update the bucket CORS policy before retrying.');
    upload = await ticket(`${resources}/${upload.id}/upload/parts/${number}`, 'PUT', { etag });
  }
  onProgress(file.size);
  return true;
}
