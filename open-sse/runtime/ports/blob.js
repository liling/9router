export const BLOB_METHODS = Object.freeze(['put', 'get', 'delete']);

export function assertBlob(port) {
  for (const method of BLOB_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`Blob.${method} is required`);
  }
  return port;
}
