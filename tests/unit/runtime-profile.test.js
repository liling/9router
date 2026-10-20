import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_PERSISTENT_FAMILY, resolveRuntimeProfile } from '../../src/lib/runtimeProfile.js';

describe('runtime profile resolution', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the closed profile set and marks only the Local persistent family', () => {
    expect(LOCAL_PERSISTENT_FAMILY).toEqual(['local-node', 'local-bun', 'docker-node']);
    for (const id of ['cloudflare-worker', 'cloud-run', 'docker-node', 'local-bun', 'local-node', 'vercel-node']) {
      expect(resolveRuntimeProfile({ RUNTIME_PROFILE: id, NODE_ENV: 'production' })).toEqual({
        id,
        isLocalPersistent: LOCAL_PERSISTENT_FAMILY.includes(id),
      });
    }
  });

  it('defaults only development to Local and fails closed in production or unknown environments', () => {
    expect(resolveRuntimeProfile({ NODE_ENV: 'development' })).toEqual({ id: 'local-node', isLocalPersistent: true });
    expect(resolveRuntimeProfile({ NODE_ENV: 'production' })).toEqual({ id: 'unknown', isLocalPersistent: false });
    expect(resolveRuntimeProfile({})).toEqual({ id: 'unknown', isLocalPersistent: false });
  });

  it('gives a legal explicit profile precedence over NODE_ENV and Vercel/Pages markers', () => {
    expect(resolveRuntimeProfile({
      RUNTIME_PROFILE: 'local-node',
      NODE_ENV: 'production',
      VERCEL: '1',
      CF_PAGES: '1',
    })).toEqual({ id: 'local-node', isLocalPersistent: true });
  });

  it('maps invalid profiles to unknown and warns', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveRuntimeProfile({ RUNTIME_PROFILE: 'next-node', NODE_ENV: 'development' })).toEqual({
      id: 'unknown',
      isLocalPersistent: false,
    });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Ignoring invalid RUNTIME_PROFILE: next-node'));
  });

  it('downgrades every Local family profile when Cloud Run identity conflicts', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of LOCAL_PERSISTENT_FAMILY) {
      expect(resolveRuntimeProfile({ RUNTIME_PROFILE: id, K_SERVICE: 'service-name' })).toEqual({
        id: 'unknown',
        isLocalPersistent: false,
      });
    }
    expect(warning).toHaveBeenCalledTimes(LOCAL_PERSISTENT_FAMILY.length);
  });

  it('does not let Vercel or Pages markers override an explicitly deployed profile', () => {
    expect(resolveRuntimeProfile({ RUNTIME_PROFILE: 'vercel-node', VERCEL: '1' })).toEqual({
      id: 'vercel-node',
      isLocalPersistent: false,
    });
    expect(resolveRuntimeProfile({ RUNTIME_PROFILE: 'cloudflare-worker', CF_PAGES: '1' })).toEqual({
      id: 'cloudflare-worker',
      isLocalPersistent: false,
    });
  });
});
