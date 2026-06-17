import assert from "node:assert/strict";
import test from "node:test";
import {
	buildResponsesWebSearchRequest,
	outputFromSse,
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
