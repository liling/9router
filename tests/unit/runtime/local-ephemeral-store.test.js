import { describe, expect, it } from 'vitest';
import { createLocalEphemeralStore } from '../../../open-sse/runtime/adapters/localEphemeralStore.js';
import { ephemeralStoreContract } from './ephemeral-store.contract.js';

ephemeralStoreContract(createLocalEphemeralStore, { describe, it });
