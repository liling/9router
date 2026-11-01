import { composeRuntime, installRuntime } from "open-sse/runtime/context.js";
import { createLocalEphemeralStore } from "open-sse/runtime/adapters/localEphemeralStore.js";
import { createLocalBackgroundTasks } from "open-sse/runtime/adapters/localBackgroundTasks.js";
import { createLocalIntervalScheduler } from "open-sse/runtime/adapters/localIntervalScheduler.js";
import { getAdapter } from "@/lib/db/driver.js";
import { createSqliteApiKeyRepository } from "@/lib/db/adapters/sqliteApiKeyRepository.js";

let startup;
let shutdown;

export function startLocalComposition({ onShutdown = (fn) => {
  process.once("SIGINT", fn);
  process.once("SIGTERM", fn);
} } = {}) {
  if (startup) return startup.then((context) => {
    installRuntime(context);
    return context;
  });
  startup = (async () => {
    const database = await getAdapter();
    const backgroundTasks = createLocalBackgroundTasks({
      onError: (error) => console.error("[BackgroundTasks] task failed:", error?.message || error),
    });
    const scheduler = createLocalIntervalScheduler({ backgroundTasks });
    const context = composeRuntime("local-node", {
      httpTransport: { fetch: globalThis.fetch.bind(globalThis) },
      persistence: createSqliteApiKeyRepository(database),
      ephemeral: createLocalEphemeralStore(),
      backgroundTasks,
      scheduler,
    });
    installRuntime(context);

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync({ scheduler });
    let refreshModule;
    try {
      refreshModule = await import("@/sse/services/backgroundTokenRefresh.js");
      refreshModule.startBackgroundTokenRefresh();
    } catch (error) {
      console.log("[BackgroundTokenRefresh] scheduler start failed:", error?.message || error);
    }

    let closed = false;
    shutdown = async () => {
      if (closed) return;
      closed = true;
      scheduler.close?.();
      await backgroundTasks.close?.({ drain: true });
      refreshModule?.stopBackgroundTokenRefresh();
    };
    onShutdown(() => { shutdown().catch((error) => console.error("[LocalRuntime] shutdown failed:", error)); });
    return context;
  })().catch((error) => {
    startup = undefined;
    throw new Error(`[LocalRuntime] composition failed: ${error?.message || error}`, { cause: error });
  });
  return startup.then((context) => {
    installRuntime(context);
    return context;
  });
}

export async function stopLocalComposition() {
  await shutdown?.();
}
