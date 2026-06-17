import assert from "node:assert/strict";
import test from "node:test";
import {
	syncWebRunActivation,
	type WebRunActivationState,
} from "../src/activation.ts";

function createPi(activeTools: string[]) {
	return {
		getActiveTools: () => activeTools,
		setActiveTools: (nextTools: string[]) => {
			activeTools = nextTools;
		},
		activeTools: () => activeTools,
	};
}

function createContext(provider: string, api: string) {
	return { model: { provider, api, id: "gpt-5" } };
}

test("activation overlays web_run on Codex Responses models", () => {
	const pi = createPi(["read", "bash", "edit", "write", "parallel"]);
	const state: WebRunActivationState = { enabled: false };

	syncWebRunActivation(
		pi as never,
		createContext("openai-codex", "openai-codex-responses") as never,
		state,
	);

	assert.deepEqual(pi.activeTools(), [
		"read",
		"bash",
		"edit",
		"write",
		"parallel",
		"web_run",
	]);
});

test("activation removes web_run away from Codex Responses models", () => {
	const pi = createPi(["read", "bash", "edit", "write", "parallel"]);
	const state: WebRunActivationState = { enabled: false };

	syncWebRunActivation(
		pi as never,
		createContext("openai-codex", "openai-codex-responses") as never,
		state,
	);
	syncWebRunActivation(
		pi as never,
		createContext("anthropic", "anthropic-messages") as never,
		state,
	);

	assert.deepEqual(pi.activeTools(), [
		"read",
		"bash",
		"edit",
		"write",
		"parallel",
	]);
});

test("activation strips persisted web_run from fresh non-Codex sessions", () => {
	const pi = createPi(["read", "bash", "web_run", "edit", "write"]);
	const state: WebRunActivationState = { enabled: false };

	syncWebRunActivation(
		pi as never,
		createContext("anthropic", "anthropic-messages") as never,
		state,
	);

	assert.deepEqual(pi.activeTools(), ["read", "bash", "edit", "write"]);
});
