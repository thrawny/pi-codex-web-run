# Upstream comparison

## Search model compatibility

Compared [upstream at 187a70d](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/187a70d621ccc99b119166e55fcd568e5b4f605e/packages/pi-codex-web-run), version 0.0.7, on 2026-10-17. This fork now follows its `gpt-6-luna` default, trimmed `PI_CODEX_MODEL` override, and `alpha/search` endpoint and JSON request contract, while retaining Pi's selected-model credentials and local page navigation.

The endpoint matters: live checks rejected both the former `gpt-5.5` default and `gpt-6-luna` on `/responses`, while `gpt-6-luna` succeeded on `/alpha/search`. Search no longer uses Responses/SSE chat requests. The existing Responses/SSE helpers remain exported for compatibility.

Returned search refs are preserved for navigation and resolve citation markers to Markdown source links. Unsafe source URLs are omitted; unknown citation refs are never guessed. The search response is not streamed, so the UI shows the initial query while pending and source URLs after completion.

## Earlier citation comparison

Reviewed [IgorWarzocha/howaboua-pi-stuff at 5193fa5](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5193fa5844a14d5ad7d1b077dfadf17eafb7e1bc) on 2026-09-06. Upstream has extracted web search from `pi-codex-conversion` into `packages/pi-codex-web-run`, currently version 0.0.2.

## Included

- The standalone tool's instruction to use returned refs for tool calls and Markdown result URLs for answers, never raw citation markers. This was introduced in [11bc73e](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/11bc73eae2d501908ec68e7b1bd1da17640a25ae).
- Local fixes for this fork's Responses/SSE implementation: model-visible source metadata and annotation-based citation links. These are not upstream ports.

## Not included

- Upstream also uses `alpha/search` for navigation. This fork uses it for search, but retains local page fetching for `open`, `click`, and `find`.
- Upstream supports configured and renamed Codex routes, and local Codex-auth fallback when the chat model uses an unrelated provider. This fork deliberately limits activation to the selected OpenAI Codex provider and uses Pi's selected-model auth. The latest auth-routing fix, [3050e5](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3050e53), primarily concerns those additional routes.
- Code/Notebook Mode registration and recent orchestration/allowlist fixes depend on integrations this fork does not use.
- Upstream bounds HTTP response size and has additional transport handling. Those are worth a separate hardening pass on this fork's search and local navigation paths; they are not part of the citation fix.

The main model receives citation-format guidance, but its messages are not rewritten. This keeps quoted examples, session content, and other extensions' rendering unchanged.
