# Upstream comparison

## Search model compatibility

Compared [upstream at 336be4d](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/336be4d27da28660d0688182b9ff983b6ccea0dc/packages/pi-codex-web-run), version 0.0.7. Its Codex route selects a dedicated search model rather than the active chat model and accepts a trimmed `PI_CODEX_MODEL` override. This fork now follows that selection behavior while retaining selected-model credentials and its Responses/SSE transport.

The default deliberately differs. Upstream uses `gpt-6-luna` with `alpha/search`. Live tests against this fork's Codex Responses endpoint rejected `gpt-6-luna` with "not supported when using Codex with a ChatGPT account", but completed searches with `gpt-5.5`. This fork therefore defaults to `gpt-5.5`. A live `executeWebRun` check with `gpt-6.1-sol` selected also completed after separating the search model. Account availability can differ; the override is not a guarantee that a model is supported.

SSE errors now preserve messages from both `error` events and `response.failed` events with nested `response.error`, rather than reporting missing text or a generic failure.

## Earlier citation comparison

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
