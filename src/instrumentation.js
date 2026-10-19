import { composeRuntime, installRuntime } from "open-sse/runtime/context.js";
import { createLocalEphemeralStore } from "open-sse/runtime/adapters/localEphemeralStore.js";
import { createLocalBackgroundTasks } from "open-sse/runtime/adapters/localBackgroundTasks.js";
import { createLocalIntervalScheduler } from "open-sse/runtime/adapters/localIntervalScheduler.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const isServerless = Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.CF_PAGES);
    let catalogLifecycle;
    if (!isServerless) {
      const backgroundTasks = createLocalBackgroundTasks();
      const scheduler = createLocalIntervalScheduler({ backgroundTasks });
      catalogLifecycle = { scheduler };
      installRuntime(composeRuntime("local-node", {
        httpTransport: { fetch: globalThis.fetch.bind(globalThis) },
        ephemeral: createLocalEphemeralStore(),
      }));
    }
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    if (catalogLifecycle) startModelCatalogSync(catalogLifecycle);
  }
}
