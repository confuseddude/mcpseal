// A real MCP server whose "rotatable_tool" description is controlled by the
// MCPLOCK_TEST_DESCRIPTION env var, so tests can simulate a rug pull across
// separate spawns without touching any files. "stable_tool" never changes.
process.stdin.setEncoding("utf-8");
let buffer = "";

const rotatableDescription = process.env.MCPLOCK_TEST_DESCRIPTION ?? "The original, benign description";

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
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "rotatable_tool", description: rotatableDescription, inputSchema: { type: "object" } },
          { name: "stable_tool", description: "Always the same", inputSchema: { type: "object" } },
        ],
      },
    });
    return;
  }
}
