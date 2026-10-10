import assert from "node:assert/strict";
import test from "node:test";
import {
	buildResponsesWebSearchRequest,
	outputFromSse,
	outputFromSseStream,
} from "../src/responses.ts";

test("buildResponsesWebSearchRequest creates Codex Responses web search payload", () => {
	const request = buildResponsesWebSearchRequest(
		{
			search_query: [
				{
					q: "OpenAI Codex release notes",
					recency: 7,
					domains: ["openai.com"],
				},
			],
			response_length: "short",
			settings: { search_context_size: "low" },
		},
		"gpt-5.5",
	);

	assert.equal(request.model, "gpt-5.5");
	assert.equal(request.tool_choice, "required");
	assert.match(String(request.instructions), /Markdown links/);
	assert.match(String(request.instructions), /not raw citation markers/);
	assert.deepEqual(request.tools, [
		{
			type: "web_search",
			external_web_access: true,
			search_context_size: "low",
		},
	]);
	assert.match(JSON.stringify(request.input), /OpenAI Codex release notes/);
	assert.match(JSON.stringify(request.input), /last 7 days/);
	assert.match(JSON.stringify(request.input), /openai.com/);
});

for (const event of [
	{ type: "error", message: "Unsupported search model" },
	{ type: "error", error: { message: "Unsupported search model" } },
	{ type: "response.failed", error: { message: "Unsupported search model" } },
	{
		type: "response.failed",
		response: { error: { message: "Unsupported search model" } },
	},
]) {
	test(`SSE preserves backend errors: ${JSON.stringify(event)}`, async () => {
		const body = `data: ${JSON.stringify(event)}\n\n`;
		assert.throws(() => outputFromSse(body), /Unsupported search model/);
		await assert.rejects(
			outputFromSseStream(new Response(body).body!),
			/Unsupported search model/,
		);
	});
}

test("SSE failure after partial text is not returned as a successful answer", () => {
	const events = [
		{ type: "response.output_text.delta", delta: "Partial answer" },
		{ type: "response.failed", response: { error: {} } },
	];
	assert.throws(
		() =>
			outputFromSse(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
			),
		/Codex web search failed/,
	);
});

test("outputFromSse collects text and URL citations", () => {
	const body = [
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "See OpenAI " })}`,
		"",
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "https://example.com." })}`,
		"",
		`data: ${JSON.stringify({ type: "response.output_item.done", item: { content: [{ annotations: [{ type: "url_citation", url: "https://openai.com/news", title: "News" }] }] } })}`,
		"",
		"data: [DONE]",
		"",
	].join("\n");

	const output = outputFromSse(body);

	assert.equal(
		output.text,
		"See OpenAI https://example.com.\n\nSources (use ref_id only for web_run calls; cite URLs in answers):\n- turn0search0: [News](<https://openai.com/news>)\n- turn0search1: [https://example.com](<https://example.com>)",
	);
	assert.deepEqual(output.searchResults, [
		{
			ref_id: "turn0search0",
			title: "News",
			url: "https://openai.com/news",
			source: "openai.com",
		},
		{
			ref_id: "turn0search1",
			title: "https://example.com",
			url: "https://example.com",
			source: "example.com",
		},
	]);
});

test("outputFromSse captures Codex-style web search activity", () => {
	const body = [
		`data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "web_search_call", id: "ws_1", status: "in_progress" } })}`,
		"",
		`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "latest Codex release" } } })}`,
		"",
		`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "open_page", url: "https://example.com/release" } } })}`,
		"",
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Answer" })}`,
		"",
		"data: [DONE]",
		"",
	].join("\n");

	const output = outputFromSse(body);

	assert.deepEqual(output.activity, [
		{
			id: "ws_1",
			type: "search",
			detail: "latest Codex release",
			completed: true,
		},
		{
			id: "ws_2",
			type: "open_page",
			detail: "https://example.com/release",
			completed: true,
		},
	]);
});

test("outputFromSseStream emits cumulative text as fragmented chunks arrive", async () => {
	const events = [
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "First " })}\n\n`,
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "second" })}\n\n`,
		"data: [DONE]\n\n",
	].join("");
	const bytes = new TextEncoder().encode(events);
	const splitPoints = [5, 19, 41, bytes.length];
	let offset = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			const end = splitPoints.shift();
			if (end === undefined) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, end));
			offset = end;
		},
	});
	const updates: string[] = [];

	const output = await outputFromSseStream(body, (partial) => {
		updates.push(partial.text);
	});

	assert.equal(output.text, "First second");
	assert.deepEqual(updates, ["First ", "First second"]);
});

function citationSse(): string {
	const marker = "citeturn2view0turn3view0";
	const text = `Two sources. ${marker}`;
	return (
		[
			{ type: "response.output_text.delta", delta: text.slice(0, 20) },
			{ type: "response.output_text.delta", delta: text.slice(20) },
			{
				type: "response.output_item.done",
				item: {
					content: [
						{
							type: "output_text",
							text,
							annotations: [
								{
									type: "url_citation",
									url: "https://example.com/one",
									title: "One",
									start_index: 13,
									end_index: text.length,
								},
								{
									type: "url_citation",
									url: "https://example.com/two",
									title: "Two",
									start_index: 13,
									end_index: text.length,
								},
							],
						},
					],
				},
			},
		]
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join("") + "data: [DONE]\n\n"
	);
}

test("SSE output turns backend citation markers into links and exposes navigation refs", () => {
	const output = outputFromSse(citationSse());
	assert.ok(
		output.text.startsWith(
			"Two sources. [One](<https://example.com/one>) [Two](<https://example.com/two>)",
		),
	);
	assert.match(output.text, /turn0search0: \[One\]/);
	assert.match(output.text, /turn0search1: \[Two\]/);
	assert.doesNotMatch(output.text, /|turn2view0|turn3view0/);
});

test("streaming and buffered citation output agree across split Unicode bytes", async () => {
	const bytes = new TextEncoder().encode(citationSse());
	let offset = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset === bytes.length) return controller.close();
			controller.enqueue(bytes.slice(offset, ++offset));
		},
	});
	assert.deepEqual(
		await outputFromSseStream(body),
		outputFromSse(citationSse()),
	);
});

test("Markdown URLs remain available as sources without annotations", () => {
	const text =
		"Read [the docs](https://example.com/docs) or [news](<https://example.com/news>).";
	const output = outputFromSse(
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`,
	);
	assert.deepEqual(
		output.searchResults.map((result) => result.url),
		["https://example.com/docs", "https://example.com/news"],
	);
	assert.ok(output.text.startsWith(text));
});

test("Markdown URLs preserve balanced parentheses", () => {
	const text = "[A page](https://example.com/page_(topic)).";
	const output = outputFromSse(
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`,
	);
	assert.deepEqual(
		output.searchResults.map((result) => result.url),
		["https://example.com/page_(topic)"],
	);
});

test("invalid and non-web annotation URLs never become source links", () => {
	const marker = "citeturn0search0";
	const events = [
		{ type: "response.output_text.delta", delta: marker },
		{
			type: "response.output_item.done",
			item: {
				content: [
					{
						text: marker,
						annotations: ["javascript:alert(1)", "not a URL"].map((url) => ({
							type: "url_citation",
							url,
							title: "Invalid",
							start_index: 0,
							end_index: marker.length,
						})),
					},
				],
			},
		},
	];
	const output = outputFromSse(
		events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
	);
	assert.equal(output.text, "[unresolved citation]");
	assert.deepEqual(output.searchResults, []);
});
