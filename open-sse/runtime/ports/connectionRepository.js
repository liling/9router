export function assertConnectionRepository(repository) {
  if (typeof repository?.listEligibleConnections !== 'function') {
    throw new TypeError('ConnectionRepository.listEligibleConnections(input) is required');
  }
  if (typeof repository?.markUnavailable !== 'function') {
    throw new TypeError('ConnectionRepository.markUnavailable(input) is required');
  }
  return repository;
}
