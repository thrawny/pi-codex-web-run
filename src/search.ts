import { formatSearchSources, markdownSourceLink } from "./citations.ts";
import type { ResponsesWebSearchOutput, WebRunArgs } from "./responses.ts";
import type { WebRunSearchResult } from "./session.ts";

// Matches upstream's alpha/search contract, not the Responses API payload.
export function buildWebSearchRequest(
	args: WebRunArgs,
	options: { id: string; model: string },
): Record<string, unknown> {
	const { settings, max_output_tokens: _ignored, ...commands } = args;
	return {
		id: options.id,
		model: options.model,
		commands,
		settings: {
			allowed_callers: ["direct"],
			external_web_access: true,
			...settings,
		},
		max_output_tokens: 2500,
	};
}

export function outputFromSearchResponse(
	value: unknown,
): ResponsesWebSearchOutput {
	if (!value || typeof value !== "object")
		throw new Error("web_run returned invalid JSON");
	const record = value as Record<string, unknown>;
	const text = record.output_text ?? record.output;
	if (typeof text !== "string" || !text.trim())
		throw new Error("web_run search returned no output");
	const rawResults = record.search_results ?? record.results;
	const searchResults: WebRunSearchResult[] = [];
	for (const value of Array.isArray(rawResults) ? rawResults : []) {
		if (!value || typeof value !== "object") continue;
		const result = value as Record<string, unknown>;
		if (typeof result.ref_id !== "string" || typeof result.url !== "string")
			continue;
		let url: URL;
		try {
			url = new URL(result.url);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		searchResults.push({
			ref_id: result.ref_id,
			url: result.url,
			title: typeof result.title === "string" ? result.title : result.url,
			source: url.hostname,
		});
	}

	const sources = new Map(
		searchResults.map((source) => [source.ref_id, source]),
	);
	const links = new Map<string, string[]>();
	for (const match of text.matchAll(/\uE200cite\uE202([^\uE201]*)\uE201/g)) {
		const resolved = match[1]!.split("\uE202").flatMap((ref) => {
			const source = sources.get(ref);
			return source ? [markdownSourceLink(source)] : [];
		});
		if (resolved.length > 0) links.set(match[0], [...new Set(resolved)]);
	}
	return {
		text: formatSearchSources(text, searchResults, links),
		searchResults,
		activity: [],
	};
}
