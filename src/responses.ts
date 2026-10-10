import {
	collectCitationLinks,
	formatSearchSources,
	type UrlCitation,
} from "./citations.ts";
import type { WebRunSearchResult } from "./session.ts";

export type SearchResponseLength = "short" | "medium" | "long";

export interface SearchQuery {
	q: string;
	recency?: number | undefined;
	domains?: string[] | undefined;
}

export interface WebRunArgs {
	search_query?: SearchQuery[] | undefined;
	image_query?: SearchQuery[] | undefined;
	open?: Array<{ ref_id: string; lineno?: number | undefined }> | undefined;
	click?: Array<{ ref_id: string; id: number }> | undefined;
	find?: Array<{ ref_id: string; pattern: string }> | undefined;
	response_length?: SearchResponseLength | undefined;
	settings?:
		| {
				search_context_size?: "low" | "medium" | "high" | undefined;
				[key: string]: unknown;
		  }
		| undefined;
	input?: unknown[] | undefined;
	max_output_tokens?: number | undefined;
	[key: string]: unknown;
}

export function buildResponsesWebSearchRequest(
	args: WebRunArgs,
	model: string,
): Record<string, unknown> {
	let prompt = searchPrompt(args);
	const responseLength = responseLengthInstruction(args.response_length);
	if (responseLength) prompt += `\n${responseLength}`;
	const input = requestInput(args.input, prompt);
	const request: Record<string, unknown> = {
		model,
		instructions:
			"You are a concise web search assistant. Use web search and answer the query. Cite sources using Markdown links to their URLs, not raw citation markers. Preserve source URL annotations.",
		input,
		tools: [
			{
				type: "web_search",
				external_web_access: true,
				search_context_size: args.settings?.search_context_size ?? "medium",
			},
		],
		tool_choice: "required",
		parallel_tool_calls: true,
		store: false,
		stream: true,
		include: [],
	};
	if (typeof args.max_output_tokens === "number")
		request.max_output_tokens = args.max_output_tokens;
	return request;
}

function searchPrompt(args: WebRunArgs): string {
	const queries = nonEmptyQueries(args.search_query);
	if (queries.length > 0) return queries.map(formatSearchQuery).join("\n");
	const imageQueries = nonEmptyQueries(args.image_query);
	if (imageQueries.length > 0)
		return imageQueries
			.map(
				(query) =>
					`Find images and current sources for: ${formatSearchQuery(query)}`,
			)
			.join("\n");
	throw new Error("web_run requires search_query or image_query");
}

function nonEmptyQueries(queries: SearchQuery[] | undefined): SearchQuery[] {
	return Array.isArray(queries)
		? queries.filter((query) => typeof query.q === "string" && query.q.trim())
		: [];
}

function formatSearchQuery(query: SearchQuery): string {
	const parts = [query.q];
	if (typeof query.recency === "number")
		parts.push(`Only include results from the last ${query.recency} days.`);
	const domains = query.domains?.filter((domain) => domain.trim());
	if (domains && domains.length > 0)
		parts.push(`Restrict results to these domains: ${domains.join(", ")}.`);
	return parts.join(" ");
}

function responseLengthInstruction(
	length: SearchResponseLength | undefined,
): string | undefined {
	if (length === "short") return "Keep the answer short and focused.";
	if (length === "medium")
		return "Use a medium-length answer with enough detail to be useful.";
	if (length === "long")
		return "Use a longer answer with fuller detail and source coverage.";
	return undefined;
}

function requestInput(
	existingInput: unknown[] | undefined,
	prompt: string,
): unknown[] {
	const searchMessage = {
		type: "message",
		role: "user",
		content: [{ type: "input_text", text: prompt }],
	};
	return Array.isArray(existingInput)
		? [...existingInput, searchMessage]
		: [searchMessage];
}

export interface WebSearchActivity {
	id?: string | undefined;
	type: "search" | "open_page" | "find_in_page" | "other";
	detail: string;
	completed: boolean;
}

export interface ResponsesWebSearchOutput {
	text: string;
	searchResults: WebRunSearchResult[];
	activity: WebSearchActivity[];
}

export type ResponsesWebSearchUpdate = (
	output: ResponsesWebSearchOutput,
) => void;

interface ResponsesSseState {
	text: string;
	searchResults: WebRunSearchResult[];
	activity: WebSearchActivity[];
	citationLinks: Map<string, string[]>;
}

export function outputFromSse(
	body: string,
	onUpdate?: ResponsesWebSearchUpdate,
): ResponsesWebSearchOutput {
	const state = createResponsesSseState();
	for (const block of body.split(/\r?\n\r?\n/))
		processSseBlock(block, state, onUpdate);
	return finishResponsesSse(state);
}

export async function outputFromSseStream(
	body: ReadableStream<Uint8Array>,
	onUpdate?: ResponsesWebSearchUpdate,
): Promise<ResponsesWebSearchOutput> {
	const state = createResponsesSseState();
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			buffer = processCompleteSseBlocks(buffer, state, onUpdate);
		}
	} finally {
		reader.releaseLock();
	}

	buffer += decoder.decode();
	buffer = processCompleteSseBlocks(buffer, state, onUpdate);
	if (buffer.trim()) processSseBlock(buffer, state, onUpdate);
	return finishResponsesSse(state);
}

function createResponsesSseState(): ResponsesSseState {
	return {
		text: "",
		searchResults: [],
		activity: [],
		citationLinks: new Map(),
	};
}

function processCompleteSseBlocks(
	input: string,
	state: ResponsesSseState,
	onUpdate: ResponsesWebSearchUpdate | undefined,
): string {
	let buffer = input;
	while (true) {
		const separator = /\r?\n\r?\n/.exec(buffer);
		if (!separator || separator.index === undefined) return buffer;
		processSseBlock(buffer.slice(0, separator.index), state, onUpdate);
		buffer = buffer.slice(separator.index + separator[0].length);
	}
}

function processSseBlock(
	block: string,
	state: ResponsesSseState,
	onUpdate: ResponsesWebSearchUpdate | undefined,
): void {
	const data = block
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trimStart())
		.join("\n");
	if (!data || data === "[DONE]") return;

	let event: unknown;
	try {
		event = JSON.parse(data);
	} catch {
		return;
	}
	if (!event || typeof event !== "object") return;
	const record = event as Record<string, unknown>;
	let changed = false;
	if (
		record.type === "response.output_text.delta" &&
		typeof record.delta === "string"
	) {
		state.text += record.delta;
		changed = true;
	}
	if (record.type === "response.output_item.added")
		changed = collectWebSearchActivity(record.item, false, state) || changed;
	if (record.type === "response.output_item.done") {
		const previousResultCount = state.searchResults.length;
		collectUrlCitations(record.item, state.searchResults, state.citationLinks);
		changed = state.searchResults.length !== previousResultCount || changed;
		changed = collectWebSearchActivity(record.item, true, state) || changed;
	}
	if (record.type === "response.failed" || record.type === "error") {
		const response =
			record.response && typeof record.response === "object"
				? (record.response as Record<string, unknown>)
				: undefined;
		const rawError = response?.error ?? record.error;
		const error =
			rawError && typeof rawError === "object"
				? (rawError as Record<string, unknown>)
				: undefined;
		throw new Error(
			typeof error?.message === "string"
				? error.message
				: typeof record.message === "string"
					? record.message
					: "Codex web search failed",
		);
	}
	if (changed) onUpdate?.(snapshotResponsesSse(state));
}

function finishResponsesSse(
	state: ResponsesSseState,
): ResponsesWebSearchOutput {
	if (!state.text.trim())
		throw new Error("web_run Responses search returned no text");
	collectPlainTextUrls(state.text, state.searchResults);
	return {
		...snapshotResponsesSse(state),
		text: formatSearchSources(
			state.text,
			state.searchResults,
			state.citationLinks,
		),
	};
}

function snapshotResponsesSse(
	state: ResponsesSseState,
): ResponsesWebSearchOutput {
	return {
		text: state.text,
		searchResults: [...state.searchResults],
		activity: state.activity.map((item) => ({ ...item })),
	};
}

function collectWebSearchActivity(
	item: unknown,
	completed: boolean,
	state: ResponsesSseState,
): boolean {
	if (!item || typeof item !== "object") return false;
	const record = item as Record<string, unknown>;
	if (record.type !== "web_search_call") return false;
	const id = typeof record.id === "string" ? record.id : undefined;
	const action = webSearchAction(record.action);
	const existing = id
		? state.activity.find((activity) => activity.id === id)
		: undefined;
	if (existing) {
		existing.type = action.type;
		existing.detail = action.detail;
		existing.completed = completed;
		return true;
	}
	state.activity.push({ id, ...action, completed });
	return true;
}

function webSearchAction(
	action: unknown,
): Pick<WebSearchActivity, "type" | "detail"> {
	if (!action || typeof action !== "object")
		return { type: "other", detail: "" };
	const record = action as Record<string, unknown>;
	if (record.type === "search") {
		const query =
			typeof record.query === "string" && record.query
				? record.query
				: undefined;
		const queries = Array.isArray(record.queries)
			? record.queries.filter(
					(query): query is string => typeof query === "string" && !!query,
				)
			: [];
		const first = query ?? queries[0] ?? "";
		return {
			type: "search",
			detail: !query && queries.length > 1 && first ? `${first} ...` : first,
		};
	}
	if (record.type === "open_page")
		return {
			type: "open_page",
			detail: typeof record.url === "string" ? record.url : "",
		};
	if (record.type === "find_in_page") {
		const url = typeof record.url === "string" ? record.url : "";
		const pattern = typeof record.pattern === "string" ? record.pattern : "";
		if (pattern && url)
			return { type: "find_in_page", detail: `'${pattern}' in ${url}` };
		return { type: "find_in_page", detail: pattern ? `'${pattern}'` : url };
	}
	return { type: "other", detail: "" };
}

function collectUrlCitations(
	item: unknown,
	results: WebRunSearchResult[],
	links: Map<string, string[]>,
): void {
	if (!item || typeof item !== "object") return;
	const content = (item as Record<string, unknown>).content;
	if (!Array.isArray(content)) return;
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const partRecord = part as Record<string, unknown>;
		const annotations = partRecord.annotations;
		if (!Array.isArray(annotations)) continue;
		const citations: UrlCitation[] = [];
		for (const annotation of annotations) {
			if (!annotation || typeof annotation !== "object") continue;
			const record = annotation as Record<string, unknown>;
			if (
				record.type !== "url_citation" ||
				typeof record.url !== "string" ||
				!isWebUrl(record.url)
			)
				continue;
			const title =
				typeof record.title === "string" && record.title.trim()
					? record.title
					: record.url;
			addSearchResult(results, record.url, title);
			citations.push({
				url: record.url,
				title,
				start_index:
					typeof record.start_index === "number"
						? record.start_index
						: undefined,
				end_index:
					typeof record.end_index === "number" ? record.end_index : undefined,
			});
		}
		if (typeof partRecord.text === "string")
			collectCitationLinks(partRecord.text, citations, links);
	}
}

function collectPlainTextUrls(
	text: string,
	results: WebRunSearchResult[],
): void {
	for (const match of text.matchAll(/https?:\/\/[^\s<>"\uE200-\uE202]+/g)) {
		let url = match[0].replace(/[,.;:\]}>'"]+$/g, "");
		// Drop Markdown's closing delimiter, but keep balanced URL parentheses.
		while (
			url.endsWith(")") &&
			(url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
		)
			url = url.slice(0, -1);
		addSearchResult(results, url, url);
	}
}

function isWebUrl(url: string): boolean {
	try {
		return ["http:", "https:"].includes(new URL(url).protocol);
	} catch {
		return false;
	}
}

function addSearchResult(
	results: WebRunSearchResult[],
	url: string,
	title: string,
): void {
	if (!isWebUrl(url) || results.some((result) => result.url === url)) return;
	let source = "";
	try {
		source = new URL(url).host;
	} catch {
		// Keep empty source.
	}
	results.push({ ref_id: `turn0search${results.length}`, title, url, source });
}
