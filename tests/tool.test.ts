import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeWebRun } from "../src/tool.ts";

function fakeJwt(accountId: string): string {
	return [
		"header",
		Buffer.from(
			JSON.stringify({
				"https://api.openai.com/auth": { chatgpt_account_id: accountId },
			}),
		).toString("base64url"),
		"signature",
	].join(".");
}

function createContext(
	options: { sessionFile: string; sessionId?: string; accountId?: string } = {
		sessionFile: "",
	},
) {
	return {
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.5",
			baseUrl: "https://chatgpt.com/backend-api/codex/responses",
		},
		modelRegistry: {
			async getApiKeyAndHeaders() {
				return {
					ok: true,
					apiKey: fakeJwt(options.accountId ?? "acct-1"),
					headers: {},
				};
			},
		},
		sessionManager: {
			getSessionFile: () => options.sessionFile,
			getSessionId: () => options.sessionId ?? "session-1",
		},
	} as never;
}

test("executeWebRun calls Codex Responses directly and stores search results for open", async () => {
	const originalFetch = globalThis.fetch;
	const dir = await mkdtemp(join(tmpdir(), "pi-codex-web-run-"));
	const sessionFile = join(dir, "session.jsonl");
	const requests: Array<{
		url: string;
		body?: unknown;
		headers?: Record<string, string>;
	}> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (init?.method === "POST") {
			requests.push({
				url,
				body: JSON.parse(String(init.body)),
				headers: Object.fromEntries(new Headers(init.headers).entries()),
			});
			const sse = [
				`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Result" })}`,
				"",
				`data: ${JSON.stringify({ type: "response.output_item.done", item: { content: [{ annotations: [{ type: "url_citation", url: "https://example.com/page", title: "Example" }] }] } })}`,
				"",
				"data: [DONE]",
				"",
			].join("\n");
			return new Response(sse, { status: 200 });
		}
		requests.push({ url });
		return new Response(
			"<html><title>Example page</title><main><p>Hello world</p><a href='/next'>Next</a></main></html>",
			{ status: 200, headers: { "content-type": "text/html" } },
		);
	}) as typeof fetch;

	try {
		const ctx = createContext({ sessionFile });
		const search = await executeWebRun(
			{ search_query: [{ q: "example" }] },
			ctx,
			undefined,
			{ sessionId: "test" },
		);
		assert.equal(search.text, "Result");
		assert.equal(
			requests[0]?.url,
			"https://chatgpt.com/backend-api/codex/responses",
		);
		assert.equal(requests[0]?.headers?.["chatgpt-account-id"], "acct-1");
		assert.match(JSON.stringify(requests[0]?.body), /example/);

		const opened = await executeWebRun(
			{ open: [{ ref_id: "turn0search0" }] },
			ctx,
			undefined,
			{ sessionId: "test" },
		);
		assert.match(opened.text, /Example page/);
		assert.match(opened.text, /Hello world/);
		assert.match(opened.text, /Next/);
	} finally {
		globalThis.fetch = originalFetch;
		await rm(dir, { recursive: true, force: true });
	}
});
