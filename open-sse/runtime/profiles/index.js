import cloudRun from './cloud-run.js';
import cloudflareWorker from './cloudflare-worker.js';
import dockerNode from './docker-node.js';
import localBun from './local-bun.js';
import localNode from './local-node.js';
import vercelNode from './vercel-node.js';

export const RUNTIME_PROFILES = Object.freeze({
  'local-node': localNode,
  'docker-node': dockerNode,
  'cloud-run': cloudRun,
  'vercel-node': vercelNode,
  'cloudflare-worker': cloudflareWorker,
  'local-bun': localBun,
});

export function getRuntimeProfile(id) {
  return RUNTIME_PROFILES[id];
}
