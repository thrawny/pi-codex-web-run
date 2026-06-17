import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CODEX_ORIGINATOR, DEFAULT_CODEX_BASE_URL } from "./constants.ts";

export const WEB_RUN_UNSUPPORTED_MESSAGE =
	"web_run requires an OpenAI Codex-compatible Responses provider";

export interface CodexWebProvider {
	responsesUrl: string;
	model: string;
	token: string;
	accountId: string;
}

export function supportsCodexWebRun(model: ExtensionContext["model"]): boolean {
	return (
		(model?.provider ?? "").toLowerCase() === "openai-codex" &&
		Boolean(model?.api?.toLowerCase().includes("responses"))
	);
}

export function resolveCodexApiProviderBaseUrl(
	modelBaseUrl: string | undefined,
): string {
	const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
	const normalized = base.replace(/\/+$/, "");
	try {
		const url = new URL(normalized);
		if (url.pathname === "" || url.pathname === "/")
			return `${normalized}/api/codex`;
	} catch {
		// Keep string-only fallback below.
	}
	if (normalized.endsWith("/codex/responses"))
		return normalized.slice(0, -"/responses".length);
	if (normalized.endsWith("/codex")) return normalized;
	if (normalized.endsWith("/backend-api") || normalized.endsWith("/api"))
		return `${normalized}/codex`;
	return normalized;
}

export function resolveCodexResponsesUrl(
	modelBaseUrl: string | undefined,
): string {
	const base = resolveCodexApiProviderBaseUrl(modelBaseUrl).replace(/\/+$/, "");
	if (base.endsWith("/codex/responses")) return base;
	return `${base}/responses`;
}

function headerValue(
	headers: Record<string, string> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) return value;
	}
	return undefined;
}

export function extractAccountId(
	token: string | undefined,
): string | undefined {
	const payload = token?.split(".")[1];
	if (!payload) return undefined;
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as Record<string, unknown>;
		const nested = claims["https://api.openai.com/auth"];
		if (nested && typeof nested === "object") {
			const accountId = (nested as Record<string, unknown>).chatgpt_account_id;
			if (typeof accountId === "string" && accountId.trim())
				return accountId.trim();
		}
		const direct = claims.chatgpt_account_id;
		return typeof direct === "string" && direct.trim()
			? direct.trim()
			: undefined;
	} catch {
		return undefined;
	}
}

export async function resolveCodexWebProvider(
	ctx: ExtensionContext,
): Promise<CodexWebProvider> {
	if (!ctx.model || !supportsCodexWebRun(ctx.model))
		throw new Error(WEB_RUN_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const token =
		auth.apiKey ??
		headerValue(auth.headers, "Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) throw new Error(WEB_RUN_UNSUPPORTED_MESSAGE);
	const accountId =
		headerValue(auth.headers, "chatgpt-account-id") ?? extractAccountId(token);
	if (!accountId)
		throw new Error("web_run could not resolve ChatGPT account id");
	return {
		responsesUrl: resolveCodexResponsesUrl(ctx.model.baseUrl),
		model: ctx.model.id,
		token,
		accountId,
	};
}

export function buildCodexHeaders(provider: CodexWebProvider): Headers {
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${provider.token}`);
	headers.set("ChatGPT-Account-ID", provider.accountId);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	headers.set("originator", CODEX_ORIGINATOR);
	headers.set("User-Agent", codexUserAgent());
	headers.set("version", "0.0.0");
	return headers;
}

function codexUserAgent(): string {
	const platform =
		process.platform === "darwin"
			? "Mac OS"
			: process.platform === "win32"
				? "Windows"
				: process.platform === "linux"
					? "Linux"
					: process.platform;
	const arch = process.arch === "arm64" ? "arm64" : process.arch;
	const terminal =
		process.env.TERM_PROGRAM?.trim() || process.env.TERM?.trim() || "unknown";
	return `${CODEX_ORIGINATOR}/0.0.0 (${platform} unknown; ${arch}) ${terminal}`;
}
