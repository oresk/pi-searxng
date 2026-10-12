// Test harness for searxng.ts — loads the extension with a mock Pi host
// and invokes the registered web_search tool against a real SearXNG instance.
//
// Usage:
//   SEARXNG_URL=https://search.yourdomain.com \
//   SEARXNG_CERT=... SEARXNG_KEY=... SEARXNG_CA=... \
//   node run-extension.mts "your query"

import searxngExtension from "../searxng.ts";

const query = process.argv[2] || "hello world";

let registered: any = null;

// Minimal mock of ExtensionAPI — only registerTool is used at load time.
const pi: any = {
	registerTool(tool: any) {
		registered = tool;
		console.log(`[harness] registered tool: ${tool.name} (${tool.label})`);
	},
};

searxngExtension(pi);

if (!registered) {
	console.error("[harness] extension did not register a tool");
	process.exit(1);
}

console.log(`[harness] SEARXNG_URL = ${process.env.SEARXNG_URL ?? "(config/default)"}`);
console.log(`[harness] mTLS cert   = ${process.env.SEARXNG_CERT ? "set" : "not set"}`);
console.log(`[harness] querying: "${query}"\n`);

const controller = new AbortController();
try {
	const result = await registered.execute("test-call-1", { query }, controller.signal);
	console.log("── result.details ──");
	console.log(result.details);
	console.log("\n── result.content ──");
	for (const c of result.content) console.log(c.text ?? c);
} catch (err) {
	console.error("[harness] execute() threw:", err instanceof Error ? err.stack : err);
	process.exit(1);
}
