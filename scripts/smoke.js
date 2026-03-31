#!/usr/bin/env node

const baseUrl = String(
  process.argv[2] || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000"
).replace(/\/+$/, "");

const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function testCase(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    failures.push({ name, message });
    console.error(`FAIL ${name}: ${message}`);
  }
}

async function main() {
  console.log(`Smoke base URL: ${baseUrl}`);

  await testCase("healthz", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body && body.ok === true, "expected ok=true");
    assert(typeof body.mcpEndpoint === "string", "expected mcpEndpoint");
  });

  await testCase("integration manifest", async () => {
    const response = await fetch(`${baseUrl}/api/integration/manifest`);
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body && body.code === 0, "expected code=0");
    assert(body.data && body.data.manifest && body.data.manifest.mcp, "missing manifest.mcp");
    assert(body.data.manifest.mcp.endpoint, "missing mcp endpoint");
  });

  await testCase("integration tools list", async () => {
    const response = await fetch(`${baseUrl}/api/integration/tools`);
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body && body.code === 0, "expected code=0");
    assert(Array.isArray(body.data?.tools), "tools should be array");
    assert(body.data.tools.length >= 3, "tools should have at least 3 items");
  });

  await testCase("integration execute unauth behavior", async () => {
    const response = await fetch(`${baseUrl}/api/integration/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "get_user_profile", args: {} }),
    });
    const body = await readJsonSafe(response);
    const allowedStatuses = new Set([200, 401]);
    assert(allowedStatuses.has(response.status), `unexpected status ${response.status}`);
    if (response.status === 200) {
      assert(body && body.code === 0, "status=200 requires code=0");
    } else {
      assert(body && body.code === 401, "status=401 requires code=401");
    }
  });

  await testCase("mcp initialize", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body && body.result && body.result.protocolVersion, "missing protocolVersion");
  });

  await testCase("mcp tools/list", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(Array.isArray(body?.result?.tools), "missing tools list");
  });

  await testCase("mcp tools/call unauth behavior", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_user_profile", arguments: {} },
      }),
    });
    const body = await readJsonSafe(response);
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body && (body.result || body.error), "expected result or error");
  });

  if (failures.length) {
    console.error(`\nSmoke tests failed: ${failures.length}`);
    failures.forEach((item, index) => {
      console.error(`${index + 1}. ${item.name} -> ${item.message}`);
    });
    process.exit(1);
  }

  console.log("\nSmoke tests passed.");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
