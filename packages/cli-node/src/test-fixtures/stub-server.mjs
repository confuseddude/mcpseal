// Minimal stub MCP server for proxy.integration.test.ts. Not a mock of the
// interception logic under test — it's a real separate process speaking
// real newline-delimited JSON-RPC over its own stdio, exercised through an
// actual spawned `mcplock proxy` in between.
process.stdin.setEncoding("utf-8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    handle(JSON.parse(line));
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } });
    return;
  }
  if (msg.method === "notifications/initialized") {
    return; // notification, no response
  }
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "safe_tool", description: "Does a safe thing", inputSchema: { type: "object" } },
          { name: "denied_tool", description: "A tool the operator denied", inputSchema: { type: "object" } },
        ],
      },
    });
    return;
  }
  if (msg.method === "tools/call") {
    send({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.params } });
    return;
  }
}
