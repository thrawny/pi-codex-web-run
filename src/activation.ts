import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { supportsCodexWebRun } from "./auth.ts";
import { WEB_RUN_TOOL_NAME } from "./constants.ts";

export interface WebRunActivationState {
	enabled: boolean;
	previousToolNames?: string[] | undefined;
}

export function syncWebRunActivation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: WebRunActivationState,
): void {
	if (supportsCodexWebRun(ctx.model)) {
		enableWebRun(pi, state);
		return;
	}
	disableWebRun(pi, state);
}

function enableWebRun(pi: ExtensionAPI, state: WebRunActivationState): void {
	const active = pi.getActiveTools();
	if (!state.enabled) {
		state.previousToolNames = stripWebRun(active);
		state.enabled = true;
	}
	pi.setActiveTools([
		...new Set([
			...(state.previousToolNames ?? stripWebRun(active)),
			WEB_RUN_TOOL_NAME,
		]),
	]);
}

function disableWebRun(pi: ExtensionAPI, state: WebRunActivationState): void {
	const active = pi.getActiveTools();
	if (!state.enabled && !active.includes(WEB_RUN_TOOL_NAME)) return;
	const base =
		state.previousToolNames && state.previousToolNames.length > 0
			? state.previousToolNames
			: stripWebRun(active);
	const restored = [...base];
	for (const toolName of active) {
		if (toolName !== WEB_RUN_TOOL_NAME && !restored.includes(toolName))
			restored.push(toolName);
	}
	pi.setActiveTools(restored);
	state.enabled = false;
	delete state.previousToolNames;
}

function stripWebRun(toolNames: string[]): string[] {
	return toolNames.filter((toolName) => toolName !== WEB_RUN_TOOL_NAME);
}
