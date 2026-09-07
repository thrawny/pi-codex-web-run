import assert from "node:assert/strict";
import test from "node:test";
import {
	collectCitationLinks,
	formatSearchSources,
	markdownSourceLink,
} from "../src/citations.ts";

const marker = "citeturn2view0turn3view0";

test("resolves grouped citation markers using annotation spans, not synthetic ref IDs", () => {
	const text = `See sources. ${marker}`;
	const links = new Map<string, string[]>();
	const sources = [
		{ url: "https://example.com/first", title: "First" },
		{ url: "https://example.com/second", title: "Second" },
	];
	collectCitationLinks(
		text,
		sources.map((source) => ({
			...source,
			start_index: text.indexOf(marker),
			end_index: text.length,
		})),
		links,
	);
	assert.equal(
		formatSearchSources(text, [], links),
		"See sources. [First](<https://example.com/first>) [Second](<https://example.com/second>)",
	);
});

test("does not guess unresolved citation URLs from result ordering", () => {
	const result = formatSearchSources(
		marker,
		[
			{
				ref_id: "turn0search0",
				url: "https://example.com",
				title: "Example",
				source: "example.com",
			},
		],
		new Map(),
	);
	assert.ok(result.startsWith("[unresolved citation]"));
	assert.match(result, /turn0search0: \[Example\]\(<https:\/\/example.com>\)/);
	assert.doesNotMatch(result, /|/);
});

test("ignores missing or non-overlapping annotation spans", () => {
	const links = new Map<string, string[]>();
	collectCitationLinks(
		`Claim ${marker}`,
		[
			{ url: "https://example.com/one", title: "One" },
			{
				url: "https://example.com/two",
				title: "Two",
				start_index: 0,
				end_index: 5,
			},
		],
		links,
	);
	assert.equal(links.size, 0);
});

test("deduplicates links and leaves ordinary Markdown alone", () => {
	const links = new Map<string, string[]>();
	const citation = {
		url: "https://example.com",
		title: "Example",
		start_index: 0,
		end_index: marker.length,
	};
	collectCitationLinks(marker, [citation, citation], links);
	assert.equal(
		formatSearchSources(marker, [], links),
		"[Example](<https://example.com>)",
	);
	assert.equal(
		formatSearchSources("[Existing](https://example.com)", [], links),
		"[Existing](https://example.com)",
	);
});

test("escapes titles and URL delimiters in Markdown source links", () => {
	assert.equal(
		markdownSourceLink({
			title: "A [title]\nwith *markup*",
			url: "https://example.com/a(b)?q=<value>",
		}),
		"[A \\[title\\] with \\*markup\\*](<https://example.com/a(b)?q=%3Cvalue%3E>)",
	);
});
