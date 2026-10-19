export const EPHEMERAL_STORE_METHODS = Object.freeze(['put', 'peek', 'consume', 'delete']);

export class EphemeralStoreConflictError extends Error {
  constructor(message = 'Ephemeral value already exists', options) {
    super(message, options);
    this.name = 'EphemeralStoreConflictError';
    this.code = 'EPHEMERAL_CONFLICT';
  }
}

export class EphemeralStoreInvalidTtlError extends TypeError {
  constructor(message = 'Ephemeral TTL must be a positive finite number', options) {
    super(message, options);
    this.name = 'EphemeralStoreInvalidTtlError';
    this.code = 'EPHEMERAL_INVALID_TTL';
  }
}

export function assertEphemeralStore(port) {
  for (const method of EPHEMERAL_STORE_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`EphemeralStore.${method} is required`);
  }
  return port;
}
