const api = "https://api.cloudflare.com/client/v4";
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const workerName = process.env.VALIDATION_WORKER;
const databaseName = process.env.VALIDATION_DATABASE;

if (!token || !accountId || !workerName || !databaseName) {
  throw new Error("Cloudflare validation environment is incomplete");
}
if (!/^9router-mem475-validation-[0-9]+-[0-9]+$/.test(workerName) || databaseName !== workerName) {
  throw new Error("Refusing a resource name outside the isolated validation namespace");
}

async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare API operation failed (${response.status}); response omitted`);
  }
  return { response, body };
}

const operation = process.argv[2];
if (operation === "preflight") {
  const databasePath = `/accounts/${accountId}/d1/database?name=${encodeURIComponent(databaseName)}`;
  const { body: databases } = await call(databasePath);
  if ((databases.result || []).some((database) => database.name === databaseName)) {
    throw new Error("Validation D1 name already exists; no resources were changed");
  }
  const scriptPath = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`;
  const { response } = await fetch(`${api}${scriptPath}`, {
    headers: { authorization: `Bearer ${token}` },
  }).then(async (response) => ({ response, body: await response.arrayBuffer() }));
  if (response.ok) throw new Error("Validation Worker name already exists; no resources were changed");
  if (response.status !== 404) throw new Error(`Worker preflight failed (${response.status}); no resources were changed`);
} else if (operation === "create-database") {
  const { body } = await call(`/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name: databaseName, primary_location_hint: "WNAM" }),
  });
  const id = body.result?.uuid;
  if (!/^[a-f0-9-]{36}$/i.test(id || "")) throw new Error("Cloudflare did not return a valid D1 identifier");
  process.stdout.write(`${id}\n`);
} else if (operation === "cleanup") {
  const databaseId = process.env.VALIDATION_DATABASE_ID || "";
  if (process.env.CLEANUP_WORKER === "true") {
    const scriptPath = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`;
    const workerResponse = await fetch(`${api}${scriptPath}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!workerResponse.ok && workerResponse.status !== 404) {
      throw new Error(`Validation Worker cleanup failed (${workerResponse.status})`);
    }
  }
  if (databaseId) {
    if (!/^[a-f0-9-]{36}$/i.test(databaseId)) throw new Error("Refusing cleanup with an invalid D1 identifier");
    const databaseResponse = await fetch(`${api}/accounts/${accountId}/d1/database/${databaseId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!databaseResponse.ok && databaseResponse.status !== 404) {
      throw new Error(`Validation D1 cleanup failed (${databaseResponse.status})`);
    }
  }
  process.stdout.write("isolated validation resources removed or already absent\n");
} else {
  throw new Error("Expected preflight, create-database, or cleanup");
}
