import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	syncWebRunActivation,
	type WebRunActivationState,
} from "./activation.ts";
import { createWebRunTool } from "./tool.ts";

export default function codexWebRun(pi: ExtensionAPI) {
	const activation: WebRunActivationState = { enabled: false };
	pi.registerTool(createWebRunTool());

	pi.on("session_start", async (_event, ctx) => {
		syncWebRunActivation(pi, ctx, activation);
	});

	pi.on("model_select", async (_event, ctx) => {
		syncWebRunActivation(pi, ctx, activation);
	});
}

export { supportsCodexWebRun } from "./auth.ts";
export {
	buildResponsesWebSearchRequest,
	outputFromSse,
	outputFromSseStream,
	type ResponsesWebSearchOutput,
	type WebSearchActivity,
} from "./responses.ts";
export { createWebRunTool, executeWebRun, webRunCallSummary } from "./tool.ts";
