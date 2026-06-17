import type { WebRunPage, WebRunPageLine, WebRunPageLink } from "./session.ts";

export async function fetchWebRunPage(
	url: string,
	index: number,
	lineno: number | undefined,
	signal: AbortSignal | undefined | null,
): Promise<WebRunPage> {
	const baseUrl = new URL(url);
	const response = await fetch(baseUrl, { signal: signal ?? undefined });
	if (!response.ok)
		throw new Error(
			`web_run open failed for ${url}: HTTP ${response.status} ${await response.text()}`,
		);
	const html = await response.text();
	const title = htmlTitle(html) ?? url;
	const readable = readableHtml(html);
	const links = htmlLinks(readable, baseUrl);
	const text = htmlToText(readable);
	const startLine = Math.max(0, (lineno ?? 1) - 1);
	const content = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => ({ line: index + 1, text: line }))
		.filter((line) => line.line > startLine)
		.slice(0, 240);
	return { ref_id: `turn${index}view0`, url, title, content, links };
}

function htmlTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = match?.[1]
		? decodeHtmlEntities(stripTags(match[1])).trim()
		: "";
	return title || undefined;
}

function readableHtml(html: string): string {
	return (
		extractElementBlock(html, "main") ??
		extractElementBlock(html, "article") ??
		extractElementBlock(html, "body") ??
		html
	);
}

function extractElementBlock(html: string, tag: string): string | undefined {
	const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
	return html.match(pattern)?.[1];
}

function htmlLinks(html: string, baseUrl: URL): WebRunPageLink[] {
	const links: WebRunPageLink[] = [];
	const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
	for (const match of html.matchAll(anchorPattern)) {
		const href = extractAttr(match[1] ?? "", "href");
		if (!href) continue;
		let url: URL;
		try {
			url = new URL(href, baseUrl);
		} catch {
			continue;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") continue;
		const text = decodeHtmlEntities(stripTags(match[2] ?? "")).trim();
		if (!text) continue;
		links.push({ id: links.length + 1, text, url: url.toString() });
		if (links.length >= 80) break;
	}
	return links;
}

function extractAttr(tag: string, attr: string): string | undefined {
	const pattern = new RegExp(
		`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
		"i",
	);
	const match = tag.match(pattern);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

function htmlToText(html: string): string {
	const withoutBlocks = removeElementBlocks(
		removeElementBlocks(html, "script"),
		"style",
	);
	const withBreaks = withoutBlocks
		.replace(/<\/(p|div|li|h[1-6]|section|article|main|br)\b[^>]*>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n");
	return decodeHtmlEntities(stripTags(withBreaks))
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s+/g, "\n");
}

function removeElementBlocks(html: string, tag: string): string {
	return html.replace(
		new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
		"",
	);
}

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

export function findInPage(
	content: WebRunPageLine[],
	pattern: string,
): WebRunPageLine[] {
	const needle = pattern.toLowerCase();
	return content.filter((line) => line.text.toLowerCase().includes(needle));
}
