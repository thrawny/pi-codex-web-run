import { randomUUID } from "node:crypto";
import type {
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildCodexHeaders,
	resolveCodexWebProvider,
	supportsCodexWebRun,
	WEB_RUN_UNSUPPORTED_MESSAGE,
} from "./auth.ts";
import { WEB_RUN_TOOL_NAME } from "./constants.ts";
import { fetchWebRunPage, findInPage } from "./page.ts";
import {
	buildResponsesWebSearchRequest,
	outputFromSse,
	type WebRunArgs,
} from "./responses.ts";
import {
	loadWebRunSession,
	saveWebRunSession,
	type WebRunPageLine,
	webRunSessionStatePath,
} from "./session.ts";

const SearchQueryParameters = Type.Object(
	{
		q: Type.String(),
		recency: Type.Optional(Type.Number({ description: "Recent days." })),
		domains: Type.Optional(
			Type.Array(Type.String(), { description: "Domains." }),
		),
	},
	{ additionalProperties: true },
);

export const WEB_RUN_PARAMETERS = Type.Object(
	{
		search_query: Type.Optional(Type.Array(SearchQueryParameters)),
		image_query: Type.Optional(Type.Array(SearchQueryParameters)),
		open: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String(), lineno: Type.Optional(Type.Number()) },
					{ additionalProperties: true },
				),
				{ description: "ref_id or URL." },
			),
		),
		click: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String(), id: Type.Number() },
					{ additionalProperties: true },
				),
			),
		),
		find: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String(), pattern: Type.String() },
					{ additionalProperties: true },
				),
			),
		),
		response_length: Type.Optional(
			Type.Union(
				[Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")],
				{ description: "Answer length." },
			),
		),
		settings: Type.Optional(
			Type.Object(
				{
					search_context_size: Type.Optional(
						Type.Union([
							Type.Literal("low"),
							Type.Literal("medium"),
							Type.Literal("high"),
						]),
					),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

export interface WebRunToolOptions {
	sessionId?: string | undefined;
}

export interface WebRunExecutionResult {
	text: string;
	details: Record<string, unknown>;
}

function hasNavigationCommands(args: WebRunArgs): boolean {
	return (
		arrayHasItems(args.open) ||
		arrayHasItems(args.click) ||
		arrayHasItems(args.find)
	);
}

function arrayHasItems(value: unknown): value is unknown[] {
	return Array.isArray(value) && value.length > 0;
}

export async function executeWebRun(
	args: WebRunArgs,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined | null,
	options: WebRunToolOptions = {},
): Promise<WebRunExecutionResult> {
	if (!supportsCodexWebRun(ctx.model))
		throw new Error(WEB_RUN_UNSUPPORTED_MESSAGE);
	if (hasNavigationCommands(args))
		return executeNavigation(args, ctx, signal, options);

	const provider = await resolveCodexWebProvider(ctx);
	const request = buildResponsesWebSearchRequest(args, provider.model);
	const response = await fetch(provider.responsesUrl, {
		method: "POST",
		headers: buildCodexHeaders(provider),
		body: JSON.stringify(request),
		signal: signal ?? undefined,
	});
	const body = await response.text();
	if (!response.ok)
		throw new Error(
			formatWebRunHttpError(provider.responsesUrl, response.status, body),
		);
	const output = outputFromSse(body);
	const statePath = webRunSessionStatePath(ctx, options.sessionId);
	const state = await loadWebRunSession(statePath);
	state.search_results = output.searchResults;
	await saveWebRunSession(statePath, state);
	return {
		text: output.text,
		details: { output_text: output.text, search_results: output.searchResults },
	};
}

function formatWebRunHttpError(
	url: string,
	status: number,
	body: string,
): string {
	if (status === 403 && body.toLowerCase().includes("cloudflare"))
		return `web_run Responses web search failed for ${url}: HTTP 403 Cloudflare challenge`;
	if (status === 404 && body.includes("Not Found"))
		return `web_run Responses web search failed for ${url}: HTTP 404 Not Found (Codex endpoint unavailable for this account/backend)`;
	return `web_run Responses web search failed for ${url}: HTTP ${status} ${body}`;
}

async function executeNavigation(
	args: WebRunArgs,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined | null,
	options: WebRunToolOptions,
): Promise<WebRunExecutionResult> {
	const statePath = webRunSessionStatePath(ctx, options.sessionId);
	const state = await loadWebRunSession(statePath);
	const opened = [];
	const finds: Array<{
		ref_id: string;
		pattern: string;
		matches: WebRunPageLine[];
	}> = [];

	if (Array.isArray(args.open)) {
		for (const open of args.open) {
			if (!open || typeof open !== "object") continue;
			const refId = String((open as Record<string, unknown>).ref_id ?? "");
			const lineno =
				typeof (open as Record<string, unknown>).lineno === "number"
					? ((open as Record<string, unknown>).lineno as number)
					: undefined;
			const url = resolveOpenUrl(state, refId);
			const page = await fetchWebRunPage(
				url,
				state.pages.length,
				lineno,
				signal,
			);
			state.pages.push(page);
			opened.push(page);
		}
	}

	if (Array.isArray(args.click)) {
		for (const click of args.click) {
			if (!click || typeof click !== "object") continue;
			const record = click as Record<string, unknown>;
			const url = resolveClickUrl(
				state,
				String(record.ref_id ?? ""),
				Number(record.id),
			);
			const page = await fetchWebRunPage(
				url,
				state.pages.length,
				undefined,
				signal,
			);
			state.pages.push(page);
			opened.push(page);
		}
	}

	if (Array.isArray(args.find)) {
		for (const find of args.find) {
			if (!find || typeof find !== "object") continue;
			const record = find as Record<string, unknown>;
			const refId = String(record.ref_id ?? "");
			const pattern = String(record.pattern ?? "");
			const page = state.pages.find((page) => page.ref_id === refId);
			if (!page) throw new Error(`web_run cannot resolve page ref_id ${refId}`);
			finds.push({
				ref_id: refId,
				pattern,
				matches: findInPage(page.content, pattern),
			});
		}
	}

	await saveWebRunSession(statePath, state);
	const details =
		opened.length === 1 && finds.length === 0
			? opened[0]
			: { open: opened, find: finds };
	return {
		text: JSON.stringify(details, null, 2),
		details: details as Record<string, unknown>,
	};
}

function resolveOpenUrl(
	state: Awaited<ReturnType<typeof loadWebRunSession>>,
	refOrUrl: string,
): string {
	if (refOrUrl.startsWith("http://") || refOrUrl.startsWith("https://"))
		return refOrUrl;
	const result = state.search_results.find(
		(result) => result.ref_id === refOrUrl,
	);
	if (result) return result.url;
	const page = state.pages.find((page) => page.ref_id === refOrUrl);
	if (page) return page.url;
	throw new Error(`web_run cannot resolve ref_id ${refOrUrl}`);
}

function resolveClickUrl(
	state: Awaited<ReturnType<typeof loadWebRunSession>>,
	refId: string,
	linkId: number,
): string {
	const page = state.pages.find((page) => page.ref_id === refId);
	if (!page) throw new Error(`web_run cannot resolve page ref_id ${refId}`);
	const link = page.links.find((link) => link.id === linkId);
	if (!link)
		throw new Error(`web_run cannot resolve link ${linkId} on ${refId}`);
	return link.url;
}

export function createWebRunTool(
	options: WebRunToolOptions = {},
): ToolDefinition<typeof WEB_RUN_PARAMETERS> {
	const toolOptions = { sessionId: randomUUID(), ...options };
	return {
		name: WEB_RUN_TOOL_NAME,
		label: WEB_RUN_TOOL_NAME,
		description: "Search/open web using Codex Responses web search.",
		promptSnippet: "Search/open web with explicit web_run args.",
		promptGuidelines: [
			"Use web_run when current web information, source lookup, or page opening is needed.",
		],
		parameters: WEB_RUN_PARAMETERS,
		prepareArguments: (args) =>
			args && typeof args === "object" ? (args as Record<string, unknown>) : {},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const output = await executeWebRun(
				params as WebRunArgs,
				ctx,
				signal,
				toolOptions,
			);
			return {
				content: [{ type: "text", text: output.text }],
				details: { webRun: output.details },
			};
		},
	};
}
