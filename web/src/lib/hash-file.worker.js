import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

self.onmessage = ({ data: file }) => {
  const hash = sha256.create();
  const reader = new FileReaderSync();
  const chunkSize = 4 * 1024 ** 2;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = file.slice(offset, offset + chunkSize);
    hash.update(new Uint8Array(reader.readAsArrayBuffer(chunk)));
    self.postMessage(offset + chunk.size);
  }
  self.postMessage(bytesToHex(hash.digest()));
};
