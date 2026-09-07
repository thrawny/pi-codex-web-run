# Upstream comparison

Reviewed [IgorWarzocha/howaboua-pi-stuff at 5193fa5](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5193fa5844a14d5ad7d1b077dfadf17eafb7e1bc) on 2026-09-06. Upstream has extracted web search from `pi-codex-conversion` into `packages/pi-codex-web-run`, currently version 0.0.2.

## Included

- The standalone tool's instruction to use returned refs for tool calls and Markdown result URLs for answers, never raw citation markers. This was introduced in [11bc73e](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/11bc73eae2d501908ec68e7b1bd1da17640a25ae).
- Local fixes for this fork's Responses/SSE implementation: model-visible source metadata and annotation-based citation links. These are not upstream ports.

## Not included

- Upstream uses Codex's `alpha/search` endpoint for search and navigation. This fork retains its direct Responses/SSE search and local page fetching. Switching endpoints needs separate compatibility testing.
- Upstream supports configured and renamed Codex routes, and local Codex-auth fallback when the chat model uses an unrelated provider. This fork deliberately limits activation to the selected OpenAI Codex provider and uses Pi's selected-model auth. The latest auth-routing fix, [3050e5](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3050e53), primarily concerns those additional routes.
- Code/Notebook Mode registration and recent orchestration/allowlist fixes depend on integrations this fork does not use.
- Upstream bounds HTTP response size and has additional transport handling. Those are worth a separate hardening pass on this fork's streaming and local navigation paths; they are not part of the citation fix.

The main model receives citation-format guidance, but its messages are not rewritten. This keeps quoted examples, session content, and other extensions' rendering unchanged.
