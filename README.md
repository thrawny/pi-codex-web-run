# pi-codex-web-run

Pi extension that adds a Codex-backed `web_run` tool without depending on Codex CLI or native helper binaries.

## Behavior

- registers only `web_run`
- activates it only when the selected model is an OpenAI Codex Responses model
- keeps Pi's stock tools active
- uses Pi's selected model auth via `ctx.modelRegistry`
- sends a direct Codex Responses web-search request from TypeScript
- renders Codex-style `Searching the web` / `Searched the web` activity without dumping the nested answer into the transcript
- keeps source URLs available in the expanded tool view
- supports `search_query`, `image_query`, `open`, `click`, and `find`

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

## Notes

This is intentionally smaller than `@howaboua/pi-codex-conversion`: no prompt adapter, no provider rewrite, no shell tools, no Rust binaries, and no Codex CLI subprocess.
