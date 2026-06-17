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
			"You are a concise web search assistant. Use web search, answer the query, and preserve source citations from annotations.",
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

export function outputFromSse(body: string): {
	text: string;
	searchResults: WebRunSearchResult[];
} {
	let text = "";
	const searchResults: WebRunSearchResult[] = [];
	for (const block of body.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data: "))
			.map((line) => line.slice("data: ".length))
			.join("\n");
		if (!data || data === "[DONE]") continue;
		let event: unknown;
		try {
			event = JSON.parse(data);
		} catch {
			continue;
		}
		if (!event || typeof event !== "object") continue;
		const record = event as Record<string, unknown>;
		if (
			record.type === "response.output_text.delta" &&
			typeof record.delta === "string"
		)
			text += record.delta;
		if (record.type === "response.output_item.done")
			collectUrlCitations(record.item, searchResults);
		if (record.type === "response.failed") {
			const error =
				record.error && typeof record.error === "object"
					? (record.error as Record<string, unknown>)
					: undefined;
			throw new Error(
				typeof error?.message === "string"
					? error.message
					: "Codex web search failed",
			);
		}
	}
	if (!text.trim())
		throw new Error("web_run Responses search returned no text");
	collectPlainTextUrls(text, searchResults);
	return { text, searchResults };
}

function collectUrlCitations(
	item: unknown,
	results: WebRunSearchResult[],
): void {
	if (!item || typeof item !== "object") return;
	const content = (item as Record<string, unknown>).content;
	if (!Array.isArray(content)) return;
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const annotations = (part as Record<string, unknown>).annotations;
		if (!Array.isArray(annotations)) continue;
		for (const annotation of annotations) {
			if (!annotation || typeof annotation !== "object") continue;
			const record = annotation as Record<string, unknown>;
			if (record.type !== "url_citation" || typeof record.url !== "string")
				continue;
			addSearchResult(
				results,
				record.url,
				typeof record.title === "string" && record.title.trim()
					? record.title
					: record.url,
			);
		}
	}
}

function collectPlainTextUrls(
	text: string,
	results: WebRunSearchResult[],
): void {
	for (const word of text.split(/\s+/)) {
		const url = word.replace(/[,.;:)\]}>'"]+$/g, "");
		if (url.startsWith("http://") || url.startsWith("https://"))
			addSearchResult(results, url, url);
	}
}

function addSearchResult(
	results: WebRunSearchResult[],
	url: string,
	title: string,
): void {
	if (results.some((result) => result.url === url)) return;
	let source = "";
	try {
		source = new URL(url).host;
	} catch {
		// Keep empty source.
	}
	results.push({ ref_id: `turn0search${results.length}`, title, url, source });
}
