export const PROCESS_METHODS = Object.freeze(['spawn', 'machineIdentity', 'localSocketReachable']);

export function assertProcess(port) {
  for (const method of PROCESS_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`Process/CLI/Socket.${method} is required`);
  }
  return port;
}
