export async function requestUpload(file, description) {
  const response = await fetch('/api/manage/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size_bytes: file.size, description })
  });
  if (!response.ok) {
    if ([400, 413].includes(response.status)) throw new Error(await response.text());
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
      else if (xhr.status === 403) reject(new Error('Upload authorization expired. Please try again.', { cause: 403 }));
      else reject(new Error('Upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Connection interrupted. Please try again.'));
    xhr.send(file);
  });
}
