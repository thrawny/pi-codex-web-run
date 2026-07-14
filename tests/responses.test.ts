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

	assert.equal(output.text, "See OpenAI https://example.com.");
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
