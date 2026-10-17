# pi-codex-web-run

Pi extension that adds a Codex-backed `web_run` tool without depending on Codex CLI or native helper binaries.

## Behavior

- registers only `web_run`
- activates it only when the selected model is an OpenAI Codex Responses model
- keeps Pi's stock tools active
- uses Pi's selected model auth via `ctx.modelRegistry`
- searches with upstream's `gpt-6-luna` default independently of the selected chat model; `PI_CODEX_MODEL` overrides the search model
- sends a direct Codex `alpha/search` request from TypeScript
- renders Codex-style `Searching the web` / `Searched the web` activity
- keeps the collapsed tool view to queries and source URLs; the full nested response appears only when the tool is expanded
- supports `search_query`, `image_query`, `open`, `click`, and `find`
- tells the model to cite Markdown URLs in answers and reserve turn refs for tool calls
- converts search-response citation markers to Markdown links using URL annotations and includes source URLs and navigation refs in model-visible output

## Install locally

```bash
pi install /absolute/path/to/pi-codex-web-run
```

For development:

```bash
pnpm install
pnpm check
pi -e /absolute/path/to/pi-codex-web-run
```

Use `pnpm format` to apply oxfmt. `pnpm check` runs oxfmt, oxlint, TypeScript, and the test suite.

## Search model

Search follows upstream's `gpt-6-luna` default and `alpha/search` endpoint; it does not send a Responses chat request. Changing Pi's chat model does not change the search model. To override the default, launch Pi with `PI_CODEX_MODEL` set to a model your Codex account supports:

```bash
PI_CODEX_MODEL=gpt-6-luna pi
```

An unset or blank value uses the default. The extension does not run Codex CLI, so updating CLI does not update its search behavior.

## Tool shape

```json
{
	"search_query": [{ "q": "latest Codex CLI release notes" }],
	"response_length": "short"
}
```

Follow-up page operations reuse `ref_id` values returned by search/open:

```json
{ "open": [{ "ref_id": "turn0search0" }] }
```

```json
{ "find": [{ "ref_id": "turn0view0", "pattern": "breaking change" }] }
```

## Citations

Pi does not render OpenAI's internal citation markers. The tool guides both the main model and its nested search assistant to use Markdown source links instead.

Search results include a source list in the tool's text content, not just UI metadata, so the main model can cite URLs and reuse `ref_id` values for navigation. When the backend still emits citation markers, annotation spans resolve them to links. Markers without matching annotations become `[unresolved citation]`; the tool never guesses URLs from result order.

This normalizes search tool output, not the main model's messages. Answer formatting still depends on the model following the tool's citation guidance.

## Acknowledgements

This project is a focused derivative of [`pi-codex-conversion`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion) from the original [`howaboua-pi-stuff`](https://github.com/IgorWarzocha/howaboua-pi-stuff) codebase. Its compact web-search UX and action formatting follow [OpenAI Codex CLI](https://github.com/openai/codex).

See [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md) for the upstream comparison and the citation guidance brought over from its standalone web tool.

## Notes

This package is intentionally smaller than the original `@howaboua/pi-codex-conversion`: no prompt adapter, no provider rewrite, no shell tools, no Rust binaries, and no Codex CLI subprocess.

## License

[MIT](LICENSE)
