import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexWebProvider } from "../src/auth.ts";

for (const [override, expected] of [
	[undefined, "gpt-5.5"],
	["", "gpt-5.5"],
	["   ", "gpt-5.5"],
	[" gpt-search-custom ", "gpt-search-custom"],
] as const) {
	test(`search model override ${JSON.stringify(override)} resolves to ${expected}`, async (t) => {
		const previous = process.env.PI_CODEX_MODEL;
		t.after(() => {
			if (previous === undefined) delete process.env.PI_CODEX_MODEL;
			else process.env.PI_CODEX_MODEL = previous;
		});
		if (override === undefined) delete process.env.PI_CODEX_MODEL;
		else process.env.PI_CODEX_MODEL = override;

		const model = {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-6.1-sol",
			baseUrl: "https://chatgpt.com/backend-api/codex/responses",
		};
		const ctx = {
			model,
			modelRegistry: {
				async getApiKeyAndHeaders(authModel: unknown) {
					// Search model selection must not change the credential source.
					assert.equal(authModel, model);
					return {
						ok: true,
						apiKey: "test-token",
						headers: { "chatgpt-account-id": "acct-test" },
					};
				},
			},
		} as unknown as ExtensionContext;

		const provider = await resolveCodexWebProvider(ctx);
		assert.equal(provider.model, expected);
		assert.equal(provider.token, "test-token");
		assert.equal(provider.accountId, "acct-test");
		assert.equal(provider.responsesUrl, model.baseUrl);
		assert.equal(model.id, "gpt-6.1-sol");
	});
}
