import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface WebRunSearchResult {
	ref_id: string;
	title: string;
	url: string;
	source: string;
}

export interface WebRunPageLine {
	line: number;
	text: string;
}

export interface WebRunPageLink {
	id: number;
	text: string;
	url: string;
}

export interface WebRunPage {
	ref_id: string;
	url: string;
	title: string;
	content: WebRunPageLine[];
	links: WebRunPageLink[];
}

export interface WebRunSessionState {
	search_results: WebRunSearchResult[];
	pages: WebRunPage[];
}

export const emptyWebRunSession = (): WebRunSessionState => ({
	search_results: [],
	pages: [],
});

export function safeSessionId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function webRunSessionStatePath(
	ctx: ExtensionContext,
	sessionId = "default",
): string {
	const sessionFile = ctx.sessionManager?.getSessionFile?.();
	const piSessionId = ctx.sessionManager?.getSessionId?.();
	if (
		typeof sessionFile === "string" &&
		sessionFile &&
		typeof piSessionId === "string" &&
		piSessionId
	) {
		return join(
			dirname(sessionFile),
			`.web-run-${safeSessionId(piSessionId)}.json`,
		);
	}
	return join(
		homedir(),
		".pi",
		"agent",
		"web-run-sessions",
		`${safeSessionId(sessionId)}.json`,
	);
}

export async function loadWebRunSession(
	path: string,
): Promise<WebRunSessionState> {
	try {
		const parsed = JSON.parse(
			await readFile(path, "utf8"),
		) as Partial<WebRunSessionState>;
		return {
			search_results: Array.isArray(parsed.search_results)
				? parsed.search_results
				: [],
			pages: Array.isArray(parsed.pages) ? parsed.pages : [],
		};
	} catch {
		return emptyWebRunSession();
	}
}

export async function saveWebRunSession(
	path: string,
	state: WebRunSessionState,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}
