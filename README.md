# @touch4it/scripts

Repository scripts. One command: `mr` — opens a GitLab merge request from your repo's own MR
template, over git push options. No API token, no editor setup.

## Setup

Add the script to the repo you open MRs from. Nothing to install — `npx` fetches the package:

```json
"scripts": {
  "mr": "npx @touch4it/scripts mr"
}
```

```bash
npm run mr                 # open the MR
npm run mr -- --dry-run    # fill it all in and print the push options, push nothing
```

`npx` resolves the latest published version on every run. To pin one, add
`@touch4it/scripts` to `devDependencies` and drop the `npx` prefix.

**Run it instead of your first `git push` on the branch, not after.** GitLab only applies push
options when the push moves a ref, so a branch that is already pushed and unchanged has nothing
to trigger them. `mr` refuses in that case and hands you a UI link.

## Your template drives it

`mr` reads `.gitlab/merge_request_templates/Default.md` from the repo you run it in and takes
every prompt default from it. Host and project come from `origin`.

- `/target_branch`, `/assign` and `/milestone` become push options. An action the template omits
  is simply not sent.
- `/reviewer`, `/assign_reviewer` and `/request_review` stay in the body — GitLab has no reviewer
  push option. Best-effort: if the line shows up as literal text, set the reviewer in the UI.
- `/milestone` must match a milestone title exactly.
- The checklist can be an `N/A | Done | Task` table or a `- [ ] Task` list. Rows you leave
  unmarked prompt for an explanation.

At any prompt, Enter keeps the default and `-` clears it. The description and the explanation
take multiple lines; Tab focuses `[ submit ]`. A title that starts with `WIP:` or `Draft:` opens
the MR as a draft.

GitLab drops a bad username or milestone without an error and `git push` still exits 0, so a
clean run is not proof the MR is right. `mr` fails the run if the server sends back `WARNINGS`,
but it cannot confirm the MR exists — only an API token could.

## Development

```bash
npm install
npm run mr -- --dry-run
npm run check             # lint + typecheck + test
```

Needs Node >= 22.18 locally, the first version that strips `.ts` types unflagged. Tests are
`node:test`, not Vitest like `app/` — so `assert`, no `expect`.

`src/bin.ts` routes commands, `src/lib/` holds what commands share, `src/mr/` is `mr` itself. A
new command is a directory under `src/` plus an entry in `COMMANDS`.

Two bits of config look wrong and are not:

- Only `dist` is published. Node refuses to strip types under `node_modules`, so a package
  shipping raw `.ts` would break every consumer.
- `overrides` pins `typescript@6` for ESLint alone. `typescript-eslint` needs the compiler API
  that `typescript@7` dropped; `tsc` stays on 7.
