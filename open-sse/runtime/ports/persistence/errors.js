export class PersistenceConflictError extends Error {
  constructor(message = 'Persistence operation conflicts with existing data', options) {
    super(message, options);
    this.name = 'PersistenceConflictError';
    this.code = 'PERSISTENCE_CONFLICT';
  }
}

export class PersistenceNotFoundError extends Error {
  constructor(message = 'Persistence record was not found', options) {
    super(message, options);
    this.name = 'PersistenceNotFoundError';
    this.code = 'PERSISTENCE_NOT_FOUND';
  }
}
