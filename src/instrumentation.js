import { resolveRuntimeProfile } from "@/lib/runtimeProfile.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const runtimeProfile = resolveRuntimeProfile();
    if (runtimeProfile.isLocalPersistent) {
      const { startLocalComposition } = await import("@/lib/runtime/localComposition.js");
      await startLocalComposition();
    }
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

  }
}
