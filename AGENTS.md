<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Novel2Screenplay — Agent Guide

AI tool that converts narrative novels into structured dramatic screenplays (YAML) and short-drama shot lists. Next.js 16 (App Router, webpack) + React 19 + TypeScript 5 + SQLite (better-sqlite3) + zod 4; npm-workspaces monorepo; dev server on port `3001`. Read this guide before editing code. Write here only what an agent cannot infer.

## Setup

```bash
npm install                     # hoisted layout via .npmrc; do not switch to pnpm layout
npm run dev                     # starts apps/screenplay on :3001
```

Required env (names only — never commit values): `DEEPSEEK_API_KEY`. Optional: `OPENAI_API_KEY`, `DB_DIR`, `DB_FILE`, `DEFAULT_MODEL_ID`, `USER_LLM_KEY`.

## Build & Test

Run these from any workspace; root scripts forward to `workspaces --if-present`.

```bash
npm run lint       # eslint src
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
npm run build      # production build (webpack)
```

- `prebuild` / `pretypecheck` / `pretest` auto-build `@novel/contracts` first — contract changes must be rebuilt before typecheck/test.
- Tests live next to source: `apps/screenplay/src/**/*.test.{ts,tsx}`.
- Vitest runs serially (`fileParallelism:false`) and against an isolated DB (`DB_DIR=data-test`, `DB_FILE=test.db`) — never the real `data/` DB.
- CI in `.github/workflows/ci.yml` gates on all four (lint/typecheck/test/build) being green; it runs `npm rebuild better-sqlite3` before build.

## Project Structure

- `apps/screenplay/` — the Next.js app: `src/app` (pages + `api/*`), `src/lib` (business logic), `src/components`, `src/__tests__` (co-located tests).
- `packages/contracts/` — `@novel/contracts`: zod-4 shared schemas (`novel`, `screenplay`, `drama`, `pipeline`) and serializers. Edit schemas here, then rebuild.
- `packages/db/` — `@novel/db`: shared job-state storage abstraction (contract-driven `pipelineState` codec). Built and wired into `apps/screenplay` pre-hooks; currently exported but not yet consumed by app repositories.
- `docs/` — design docs and records. `docs/项目框架.md` is the live architecture map; root `README.md` structure section is stale — trust this guide and `docs/项目框架.md`.
- `.trae/specs/` + `.trae/documents/` — plan/spec/plan documents.
- `scripts/e2e/` + `scripts/shot/` — integration and screenshot workers; **not committed.**

Key code map (all under `apps/screenplay/src/lib/`): `pipeline/` four-phase engine · `llm/` providers + registry + adapters + user-LLM gateway · `novel/` parser · `drama/` harmonization engine · `agent/` AgentCore · `multi-agent/` orchestrator + review gates · `jobs/` shared job types + screenplay snapshot · `sse/` client manager · `store/sqlite/` repositories + `schema.sql` · `debug/` evaluator.

## Code Style

Show, don't tell — patterns already in the codebase:

```ts
// Good: validate at the source contract layer
import { screenplaySchema } from '@novel/contracts';
const parsed = screenplaySchema.safeParse(body);

// Bad: trusting raw input and patching shape later
// @ts-ignore unknowable fields
const s = body; // no zod guard, no shape guarantee
```

- Data contracts first: change `packages/contracts` schemas before consuming code.
- Components `PascalCase.tsx`; functions/fields `camelCase`; API routes in `src/app/api/**/route.ts`.
- No empty `catch` — if swallowing, comment what is swallowed and why.
- Keep business logic in `src/lib`; pages/routes stay thin.

## Commits & PRs

- Conventional Commits (`feat|fix|test|chore|...`); messages describe intent, not diff.
- Split per concern (one logical change per commit), matching recent history.
- Merge only after `lint` + `typecheck` + `test` pass.

## Guardrails

- **Always:** re-run `lint`, `typecheck`, `test` until green after each change; add a test for new/modified code; put contract changes in `packages/contracts` and rebuild it.
- **Ask first:** SQLite schema migration (`store/sqlite/schema.sql`, bump `schema_version`); adding a dependency; editing CI/CD; pushing to `main` or any force-push; altering an established module boundary.
- **Never:** commit secrets, `*.env*`, or real credentials; edit generated/build output; stage `pr-evidence/`, `scripts/e2e/`, `scripts/shot/` (workflow artifacts stay out of the repo); import `@novel/db` into app repositories without routing job persistence through its shared codec; reintroduce the old in-memory job queue (`src/lib/jobs/job-queue.ts`/`worker.ts` were removed — keep the single `PipelineEngine + jobStore` execution path).

## Monorepo Nesting

Closest AGENTS.md wins (closest-file-wins); this root file is the fallback baseline. `CLAUDE.md` is an `@AGENTS.md` reference, not a second copy.