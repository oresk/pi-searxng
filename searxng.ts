// SPDX-FileCopyrightText: 2026 Copyright (c) 2026 Lovro Oreskovic
// SPDX-FileCopyrightText: 2026 Copyright (c) 2026 Helio Chissini de Castro
//
// SPDX-License-Identifier: MIT

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Agent, fetch } from "undici";

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-searxng.jsonc");

interface SearXNGConfig {
	searxngUrl: string;
	timeoutMs: number;
	maxResults: number;
	safesearch: "off" | "moderate" | "strict";
	// mTLS certificate paths (optional)
	mtlsCert: string;
	mtlsKey: string;
	mtlsCa: string;
}

const ConfigSchema = Type.Object(
	{
		searxngUrl: Type.String({
			description: "SearXNG instance URL (e.g. http://localhost:8080)",
		}),
		timeoutMs: Type.Number({
			minimum: 1000,
			maximum: 120000,
			description: "Request timeout in milliseconds",
		}),
		maxResults: Type.Number({
			minimum: 1,
			maximum: 50,
			description: "Max results per search",
		}),
		safesearch: Type.Union(
			[Type.Literal("off"), Type.Literal("moderate"), Type.Literal("strict")],
			{ description: 'SafeSearch level: "off", "moderate", or "strict"' },
		),
		mtlsCert: Type.Optional(
			Type.String({ description: "Path to client TLS certificate for mTLS" }),
		),
		mtlsKey: Type.Optional(
			Type.String({ description: "Path to client TLS private key for mTLS" }),
		),
		mtlsCa: Type.Optional(
			Type.String({
				description: "Path to CA certificate for verifying the server",
			}),
		),
	},
	{ additionalProperties: false },
);

const DEFAULT_CONFIG: SearXNGConfig = {
	searxngUrl: "http://localhost:8080",
	timeoutMs: 30000,
	maxResults: 10,
	safesearch: "off",
	mtlsCert: "",
	mtlsKey: "",
	mtlsCa: "",
};

const CONFIG_TEMPLATE = `{
	// SearXNG instance URL.
	// Override with the SEARXNG_URL environment variable.
	"searxngUrl": "http://localhost:8080",

	// Request timeout in milliseconds.
	"timeoutMs": 30000,

	// Maximum number of results per search (1–50).
	"maxResults": 10,

	// SafeSearch level: "off", "moderate", or "strict".
	"safesearch": "off",

	// ── mTLS (mutual TLS) ────────────────────────────────────────────────
	// Set these paths to authenticate with a SearXNG instance that requires
	// client certificates. Override with SEARXNG_CERT, SEARXNG_KEY, SEARXNG_CA.
	// "mtlsCert": "/path/to/client-cert.pem",
	// "mtlsKey":  "/path/to/client-key.pem",
	// "mtlsCa":   "/path/to/ca-cert.pem"
}
`;

/** Strip JSONC comments (line and block) so the config can be parsed as JSON. */
function stripJsonComments(raw: string): string {
	let out = "";
	let i = 0;
	while (i < raw.length) {
		// String literal — keep verbatim
		if (raw[i] === '"') {
			out += '"';
			i++;
			while (i < raw.length && raw[i] !== '"') {
				if (raw[i] === "\\" && i + 1 < raw.length) {
					out += raw[i] + raw[i + 1];
					i += 2;
				} else {
					out += raw[i];
					i++;
				}
			}
			if (i < raw.length) {
				out += '"';
				i++;
			}
			continue;
		}
		// Line comment
		if (raw[i] === "/" && raw[i + 1] === "/") {
			while (i < raw.length && raw[i] !== "\n") i++;
			if (i < raw.length) {
				out += "\n";
				i++;
			}
			continue;
		}
		// Block comment
		if (raw[i] === "/" && raw[i + 1] === "*") {
			i += 2;
			while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		out += raw[i];
		i++;
	}
	return out;
}

function loadConfig(): SearXNGConfig {
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	} catch {
		/* dir already exists */
	}

	if (!existsSync(CONFIG_PATH)) {
		try {
			writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE, "utf-8");
		} catch {
			/* read-only fs */
		}
		return DEFAULT_CONFIG;
	}

	try {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		const stripped = stripJsonComments(raw);
		const parsed = JSON.parse(stripped);
		const merged = { ...DEFAULT_CONFIG, ...parsed };

		if (!Check(ConfigSchema, merged)) {
			const errorList = [...Errors(ConfigSchema, merged)]
				.map((e) => `${e.path}: ${e.message}`)
				.join("; ");
			console.warn(
				`[pi-searxng] Invalid config (${CONFIG_PATH}): ${errorList}. Using defaults.`,
			);
			return DEFAULT_CONFIG;
		}

		return merged as SearXNGConfig;
	} catch (err) {
		console.warn(
			`[pi-searxng] Failed to parse config (${CONFIG_PATH}): ${
				err instanceof Error ? err.message : String(err)
			}. Using defaults.`,
		);
		return DEFAULT_CONFIG;
	}
}

function resolveSearxngUrl(config: SearXNGConfig): string {
	return process.env.SEARXNG_URL || config.searxngUrl;
}

function resolveMtlsCert(config: SearXNGConfig): string {
	return process.env.SEARXNG_CERT || config.mtlsCert;
}

function resolveMtlsKey(config: SearXNGConfig): string {
	return process.env.SEARXNG_KEY || config.mtlsKey;
}

function resolveMtlsCa(config: SearXNGConfig): string {
	return process.env.SEARXNG_CA || config.mtlsCa;
}

/**
 * Build an undici Agent for mTLS when cert + key are configured.
 *
 * Node's global `fetch` is undici under the hood, and undici's fetch ignores
 * the classic `node:https` `agent` option entirely — client certs never get
 * sent. The dispatcher must be an undici `Agent` passed via the `dispatcher`
 * fetch option, so both the Agent and `fetch` here are imported from `undici`
 * directly (mixing a standalone undici Agent with Node's internally bundled
 * undici fetch throws on version mismatch).
 */
function createMtlsAgent(config: SearXNGConfig): Agent | undefined {
	const certPath = resolveMtlsCert(config);
	const keyPath = resolveMtlsKey(config);
	const caPath = resolveMtlsCa(config);

	if (!certPath || !keyPath) return undefined;

	const connectOpts: { cert?: string; key?: string; ca?: string } = {};

	if (certPath && existsSync(certPath)) {
		connectOpts.cert = readFileSync(certPath, "utf-8");
	}
	if (keyPath && existsSync(keyPath)) {
		connectOpts.key = readFileSync(keyPath, "utf-8");
	}
	if (caPath && existsSync(caPath)) {
		connectOpts.ca = readFileSync(caPath, "utf-8");
	}

	if (!connectOpts.cert || !connectOpts.key) {
		console.warn(
			"[pi-searxng] mTLS cert or key not found — falling back to plain TLS.",
		);
		return undefined;
	}

	return new Agent({ connect: connectOpts });
}

interface SearXNGResult {
	title: string;
	url: string;
	content?: string;
	publishedDate?: string;
	engines?: string[];
	score?: number;
}

interface SearXNGResponse {
	results: SearXNGResult[];
	answers?: Array<{ answer: string }>;
	infoboxes?: Array<{ infobox: string; content: string }>;
	suggestions?: string[];
	corrections?: string[];
}

export default function searxngExtension(pi: ExtensionAPI) {
	const config = loadConfig();
	const searxngUrl = resolveSearxngUrl(config);
	const mtlsAgent = createMtlsAgent(config);

	pi.registerTool({
		name: "web_search",
		label: "SearXNG",
		description: `Search the web via a self-hosted SearXNG instance aggregating multiple engines.

Available categories (comma-separated for multiple):
- general / web — broad web search (google, brave, duckduckgo, startpage)
- news       — bing news, google news, reuters, yahoo news
- it         — stackoverflow, mdn, github, pypi, docker hub, arch wiki, askubuntu
- science    — arxiv, pubmed, google scholar, semantic scholar
- scientific publications — arxiv, pubmed, semantic scholar
- packages   — pypi, docker hub, hoogle
- repos      — github
- q&a        — stackoverflow, askubuntu, superuser
- images     — google images, bing images, unsplash, pexels, flickr
- videos     — youtube, vimeo, dailymotion
- social media — mastodon, lemmy
- software wikis — arch linux wiki, gentoo wiki
- map        — openstreetmap
- weather    — wttr.in (structured weather data)
- translate  — lingva, dictzone
- dictionaries / define — wiktionary, wordnik, etymonline
- music      — bandcamp, soundcloud, youtube
- files      — piratebay, solidtorrents
- wikimedia  — wiktionary, wikinews`,
		promptSnippet:
			"Search the web with SearXNG (self-hosted, multi-engine aggregator)",
		parameters: Type.Object({
			query: Type.String({
				description:
					"Search query. Supports engine-specific syntax (e.g. site:, filetype:).",
			}),
			categories: Type.Optional(
				Type.String({
					description:
						'Category or comma-separated categories (default: "general"). See tool description for full list.',
				}),
			),
			language: Type.Optional(
				Type.String({
					description:
						'Language code for results, e.g. "en", "hr", "de" (default: instance setting)',
				}),
			),
			timeRange: Type.Optional(
				Type.String({
					description: 'Recency filter: "day", "month", or "year"',
				}),
			),
			page: Type.Optional(
				Type.Integer({
					description: "Page number for more results (default: 1)",
				}),
			),
			engines: Type.Optional(
				Type.String({
					description:
						'Comma-separated engines to use, e.g. "google,duckduckgo,github". Overrides category defaults.',
				}),
			),
			numResults: Type.Optional(
				Type.Integer({
					description: "Max results to return (default: 10, max: 20)",
				}),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(new Error("SearXNG request timed out")),
				config.timeoutMs,
			);
			if (signal) {
				signal.addEventListener(
					"abort",
					() => controller.abort(signal.reason),
					{ once: true },
				);
			}

			const url = new URL(`${searxngUrl}/search`);
			url.searchParams.set("q", params.query);
			url.searchParams.set("format", "json");
			url.searchParams.set("categories", params.categories ?? "general");
			url.searchParams.set(
				"safesearch",
				String(
					config.safesearch === "moderate"
						? 1
						: config.safesearch === "strict"
							? 2
							: 0,
				),
			);
			if (params.language) url.searchParams.set("language", params.language);
			if (params.timeRange)
				url.searchParams.set("time_range", params.timeRange);
			if (params.page && params.page > 1)
				url.searchParams.set("pageno", String(params.page));
			if (params.engines) url.searchParams.set("engines", params.engines);

			const fetchOpts: Parameters<typeof fetch>[1] = {
				signal: controller.signal,
			};
			// Attach mTLS dispatcher for https requests
			if (mtlsAgent && searxngUrl.startsWith("https://")) {
				fetchOpts.dispatcher = mtlsAgent;
			}
			const res = await fetch(url.toString(), fetchOpts);
			clearTimeout(timeout);
			if (!res.ok)
				throw new Error(`SearXNG error: ${res.status} ${res.statusText}`);

			const data = (await res.json()) as SearXNGResponse;
			const limit = Math.min(params.numResults ?? 10, 20);
			const results = data.results.slice(0, limit);

			const lines: string[] = [];

			if (data.answers?.length) {
				lines.push(`**Answer:** ${data.answers[0].answer}\n`);
			}

			if (data.infoboxes?.length) {
				const box = data.infoboxes[0];
				lines.push(`**${box.infobox}:** ${box.content}\n`);
			}

			if (data.corrections?.length) {
				lines.push(`**Did you mean:** ${data.corrections.join(", ")}\n`);
			}

			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				const engines = r.engines?.length ? ` _(${r.engines.join(", ")})_` : "";
				const score = r.score != null ? ` [score: ${r.score.toFixed(2)}]` : "";
				const date = r.publishedDate
					? ` · ${r.publishedDate.slice(0, 10)}`
					: "";
				lines.push(`${i + 1}. **${r.title}**${date}${engines}${score}`);
				lines.push(`   ${r.url}`);
				if (r.content) lines.push(`   ${r.content.slice(0, 400)}`);
				lines.push("");
			}

			if (data.suggestions?.length) {
				lines.push(
					`**Related searches:** ${data.suggestions.slice(0, 5).join(" · ")}`,
				);
			}

			const text = lines.join("\n").trim() || "No results found.";
			return {
				content: [{ type: "text", text }],
				details: { resultCount: results.length, query: params.query },
			};
		},

		renderCall(args, theme) {
			const q = (args.query ?? "").slice(0, 50);
			const cat = args.categories
				? theme.fg("muted", ` [${args.categories}]`)
				: "";
			return new Text(
				theme.fg("toolTitle", "search ") + theme.fg("accent", `"${q}"`) + cat,
				0,
				0,
			);
		},

		renderResult(result, _opts, theme) {
			const count = (result.details as any)?.resultCount ?? 0;
			return new Text(
				theme.fg("success", `${count} result${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},
	});
}
