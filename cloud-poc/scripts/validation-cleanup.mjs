const validationTables = [
  "api_keys",
  "ephemeral_probe",
  "ephemeral_isolation",
  "ephemeral_context",
  "validation_background",
];

export async function cleanupValidationRows(request, suffix, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await request("/probe/validation/cleanup", { method: "POST", body: { suffix } });
      attempts.push(response.json.outcomes || {});
      if (response.status === 200 && validationTables.every((table) => response.json.outcomes?.[table] !== undefined &&
          response.json.outcomes[table] !== "failed")) break;
    } catch {
      attempts.push({});
    }
    await pause(250);
  }
  const outcomes = Object.fromEntries(validationTables.map((table) => {
    const observed = attempts.map((result) => result[table]).filter(Boolean);
    return [table, observed.length ? { attempts: observed, outcome: observed.at(-1) } : "not-observed"];
  }));
  const ok = Object.values(outcomes).every((result) => result !== "not-observed" && result.outcome !== "failed");
  return { ok, outcomes };
}
