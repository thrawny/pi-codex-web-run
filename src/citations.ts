import type { WebRunSearchResult } from "./session.ts";

export interface UrlCitation {
	url: string;
	title: string;
	start_index?: number;
	end_index?: number;
}

export function markdownSourceLink(source: {
	url: string;
	title: string;
}): string {
	const label = source.title
		.replace(/\s+/g, " ")
		.replace(/[\\`*_[\]<>]/g, "\\$&");
	const url = source.url.replace(/[\s<>\\]/g, (char) =>
		encodeURIComponent(char),
	);
	return `[${label}](<${url}>)`;
}

/** Annotation offsets belong to their output_text part, not the combined response. */
export function collectCitationLinks(
	text: string,
	annotations: UrlCitation[],
	links: Map<string, string[]>,
): void {
	for (const match of text.matchAll(/\uE200cite\uE202[^\uE201]*\uE201/g)) {
		const start = match.index;
		const end = start + match[0].length;
		const sources = annotations.filter(
			(annotation) =>
				typeof annotation.start_index === "number" &&
				typeof annotation.end_index === "number" &&
				Number.isInteger(annotation.start_index) &&
				Number.isInteger(annotation.end_index) &&
				annotation.start_index >= 0 &&
				annotation.end_index <= text.length &&
				annotation.start_index < annotation.end_index &&
				annotation.start_index < end &&
				annotation.end_index > start,
		);
		if (sources.length === 0) continue;
		const resolved = links.get(match[0]) ?? [];
		for (const source of sources) {
			const link = markdownSourceLink(source);
			if (!resolved.includes(link)) resolved.push(link);
		}
		links.set(match[0], resolved);
	}
}

export function formatSearchSources(
	text: string,
	results: WebRunSearchResult[],
	links: Map<string, string[]>,
): string {
	const answer = text.replace(
		/\uE200cite\uE202[^\uE201]*\uE201/g,
		(marker) => links.get(marker)?.join(" ") ?? "[unresolved citation]",
	);
	if (results.length === 0) return answer;
	return `${answer}\n\nSources (use ref_id only for web_run calls; cite URLs in answers):\n${results
		.map((source) => `- ${source.ref_id}: ${markdownSourceLink(source)}`)
		.join("\n")}`;
}
