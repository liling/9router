export const HTTP_TRANSPORT_METHODS = Object.freeze(['fetch']);

export function assertHttpTransport(port) {
  if (typeof port?.fetch !== 'function') throw new TypeError('HttpTransport.fetch(url, options, proxyOptions?) is required');
  return port;
}
