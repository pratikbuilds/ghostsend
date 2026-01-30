# Agent rules

## Format and lint

- **Do not** include formatting-only changes (trailing commas, semicolons, quotes, line breaks) in feature diffs. They waste tokens and make review noisy.
- **Before committing:** run `pnpm format` then `pnpm lint`. Use `pnpm check` to verify (`format:check` + `lint`).
- If you edit code, run `pnpm format` once so the diff stays minimal; the rest of the repo is already formatted.

## Commands

- `pnpm format` — format entire project (Prettier).
- `pnpm format:check` — fail if any file is not formatted.
- `pnpm lint` — lint entire project (app + backend source only; `dist` is ignored).
- `pnpm lint:fix` — auto-fix what ESLint can.
- `pnpm check` — run format check + lint (use in CI or before push).
