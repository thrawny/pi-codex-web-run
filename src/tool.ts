import { randomUUID } from "node:crypto";
import type {
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
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
	outputFromSseStream,
	type ResponsesWebSearchOutput,
	type WebRunArgs,
	type WebSearchActivity,
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
				{
					description: "Answer length.",
				},
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
	onUpdate?: ((result: WebRunExecutionResult) => void) | undefined;
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
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			formatWebRunHttpError(provider.responsesUrl, response.status, body),
		);
	}
	const handleUpdate = options.onUpdate
		? (output: ResponsesWebSearchOutput) =>
				options.onUpdate?.(webRunSearchResult(output))
		: undefined;
	const output = response.body
		? await outputFromSseStream(response.body, handleUpdate)
		: outputFromSse(await response.text(), handleUpdate);
	const statePath = webRunSessionStatePath(ctx, options.sessionId);
	const state = await loadWebRunSession(statePath);
	state.search_results = output.searchResults;
	await saveWebRunSession(statePath, state);
	return webRunSearchResult(output);
}

function webRunSearchResult(
	output: ResponsesWebSearchOutput,
): WebRunExecutionResult {
	return {
		text: output.text,
		details: {
			output_text: output.text,
			search_results: output.searchResults,
			activity: output.activity,
		},
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

interface WebRunRenderState {
	completed?: boolean;
	activity?: WebSearchActivity[];
}

export function createWebRunTool(
	options: WebRunToolOptions = {},
): ToolDefinition<typeof WEB_RUN_PARAMETERS, unknown, WebRunRenderState> {
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
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			let lastActivity = "";
			const output = await executeWebRun(params as WebRunArgs, ctx, signal, {
				...toolOptions,
				onUpdate: (partial) => {
					toolOptions.onUpdate?.(partial);
					const activity = webSearchActivity(partial.details);
					const activityKey = JSON.stringify(activity);
					if (activityKey === lastActivity) return;
					lastActivity = activityKey;
					onUpdate?.({
						content: [{ type: "text", text: "" }],
						details: { webRun: partial.details },
					});
				},
			});
			return {
				content: [{ type: "text", text: output.text }],
				details: { webRun: output.details },
			};
		},
		renderCall(args, theme, context) {
			const fallbackDetail = webRunCallSummary(args as WebRunArgs);
			const activity =
				context.state.activity && context.state.activity.length > 0
					? context.state.activity
					: [
							{
								type: "other" as const,
								detail: fallbackDetail,
								completed: context.state.completed ?? false,
							},
						];
			const text = activity
				.map((item, index) => {
					const completed = item.completed || context.state.completed === true;
					const detail = item.detail || (index === 0 ? fallbackDetail : "");
					const header = completed ? "Searched the web" : "Searching the web";
					let line = theme.fg("muted", "• ");
					line += theme.fg("toolTitle", theme.bold(header));
					if (detail && detail !== "web request") {
						line += completed ? " for " : " ";
						line += theme.fg("accent", detail);
					}
					return line;
				})
				.join("\n");
			const component =
				context.lastComponent instanceof Text
					? context.lastComponent
					: new Text("", 0, 0);
			component.setText(text);
			return component;
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const activity = webSearchActivity(result.details);
			const completed = !isPartial;
			if (
				context.state.completed !== completed ||
				JSON.stringify(context.state.activity) !== JSON.stringify(activity)
			) {
				context.state.completed = completed;
				context.state.activity = activity;
				context.invalidate();
			}
			if (!expanded || isPartial) return new Container();
			const sources = webSearchResultUrls(result.details);
			if (sources.length === 0) return new Container();
			const shown = sources.slice(0, 8);
			let text = shown.map((url) => theme.fg("dim", `  └ ${url}`)).join("\n");
			if (sources.length > shown.length)
				text += `\n${theme.fg("muted", `  … ${sources.length - shown.length} more sources`)}`;
			return new Text(text, 0, 0);
		},
	};
}

function webSearchActivity(details: unknown): WebSearchActivity[] {
	if (!details || typeof details !== "object") return [];
	const webRun = (details as Record<string, unknown>).webRun;
	const record =
		webRun && typeof webRun === "object"
			? (webRun as Record<string, unknown>)
			: (details as Record<string, unknown>);
	return Array.isArray(record.activity)
		? (record.activity as WebSearchActivity[])
		: [];
}

function webSearchResultUrls(details: unknown): string[] {
	if (!details || typeof details !== "object") return [];
	const webRun = (details as Record<string, unknown>).webRun;
	if (!webRun || typeof webRun !== "object") return [];
	const results = (webRun as Record<string, unknown>).search_results;
	if (!Array.isArray(results)) return [];
	return results.flatMap((result) =>
		result &&
		typeof result === "object" &&
		typeof (result as Record<string, unknown>).url === "string"
			? [(result as Record<string, unknown>).url as string]
			: [],
	);
}

export function webRunCallSummary(args: WebRunArgs): string {
	const operations: string[] = [];
	const searchQueries = nonEmptyQueryText(args.search_query);
	if (searchQueries.length > 0) operations.push(searchQueries.join(" · "));
	const imageQueries = nonEmptyQueryText(args.image_query);
	if (imageQueries.length > 0)
		operations.push(`images: ${imageQueries.join(" · ")}`);
	if (arrayHasItems(args.open))
		operations.push(
			`open ${args.open
				.map((item) => String(item?.ref_id ?? ""))
				.filter(Boolean)
				.join(", ")}`,
		);
	if (arrayHasItems(args.click))
		operations.push(
			`click ${args.click
				.map(
					(item) => `${String(item?.ref_id ?? "")}#${String(item?.id ?? "")}`,
				)
				.join(", ")}`,
		);
	if (arrayHasItems(args.find))
		operations.push(
			`find ${args.find
				.map((item) => String(item?.pattern ?? ""))
				.filter(Boolean)
				.join(", ")}`,
		);
	return (
		operations.filter((operation) => !operation.endsWith(" ")).join("; ") ||
		"web request"
	);
}

function nonEmptyQueryText(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) =>
			item && typeof item === "object"
				? String((item as Record<string, unknown>).q ?? "").trim()
				: "",
		)
		.filter(Boolean);
}
