# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@touch4it/scripts` is a published npm CLI. The `mr` command opens a GitLab merge request from the consuming repo's own MR template using git push options — no API token, no GitLab API call.

## Commands

```bash
npm run mr                 # run the CLI (node src/bin.ts mr)
npm run mr -- --dry-run    # build push options and print them, push nothing
npm run check              # lint:ci + typecheck + test — the pre-publish gate
npm run lint               # eslint --fix over src test eslint.config.js
npm run typecheck          # tsc --noEmit
npm test                   # node --test
npm run build              # tsc -p tsconfig.build.json -> dist/ (publish only)
```

Run one test file: `node --test test/mr/template.test.ts`. Filter by name: `node --test --test-name-pattern parseTasks`.

Tests use `node:test` with `node:assert/strict`.

## Toolchain — things that look wrong but are intentional

- **No transpile step in dev.** Node runs `src/*.ts` directly via native type-stripping; imports carry `.ts` extensions and `tsconfig` sets `erasableSyntaxOnly` + `rewriteRelativeImportExtensions` + `verbatimModuleSyntax` to keep the source strip-safe. Needs Node >= 22.18 locally. `engines.node` (>=20.12.0) targets consumers of the built `dist/`, not this repo.
- **Only `dist/` is published** (`files` + `.gitignore`). Node refuses to strip types under `node_modules`, so shipping raw `.ts` would break every consumer.
- **`overrides` pins `typescript@6` for `eslint-config-xo` alone.** `typescript-eslint` needs a compiler API that `typescript@7` dropped; `tsc` itself runs on 7. Do not unify these.

## Architecture

`src/bin.ts` routes an argv command through a `COMMANDS` map. A new command is a directory under `src/` plus an entry in that map.

- `src/lib/` — git calls, origin-URL parsing, and `@clack/prompts` helpers shared across commands.
- `src/mr/` — the `mr` command: `index.ts` is the interactive flow and git-state guards, `template.ts` the pure template parsing and body assembly the tests concentrate on.

One non-obvious `mr` behavior: GitLab silently drops a bad username or milestone and `git push` still exits 0, so a clean run does not prove the MR is right. `mr` only fails on a `WARNINGS` response and cannot confirm the MR exists.

The `.gitlab/merge_request_templates/*.md` files here are test fixtures for `template.test.ts`, not this repo's own MR templates.
