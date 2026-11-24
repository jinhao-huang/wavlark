export async function requestUpload(file, directory, description, requestId, draftId) {
  const response = draftId
    ? await fetch(`/api/manage/resources/${draftId}/upload`, { method: 'POST' })
    : await fetch('/api/manage/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, name: file.name, size_bytes: file.size, directory, description })
      });
  if (!response.ok) {
    if ([400, 404, 409, 410, 413].includes(response.status)) {
      throw new Error(await response.text(), { cause: response.status });
    }
    throw new Error('Could not start the upload. Check your sign-in and try again.');
  }
  return response.json();
}

export function sendFile(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.url);
    for (const [name, value] of Object.entries(upload.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = ({ loaded }) => onProgress(loaded);
    xhr.onload = () => {
      // A previous PUT may have succeeded before its response was lost.
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412) resolve();
      else if (xhr.status === 403) reject(new Error('Upload authorization failed. Retry to get a new upload link.'));
      else reject(new Error('Upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Connection interrupted. Please try again.'));
    xhr.send(file);
  });
}
