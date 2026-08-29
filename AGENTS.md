# Agent Instructions

## Git hygiene

- Check `git status --short --branch` before editing and before handoff. Treat every pre-existing change as user work; preserve it unless the task explicitly owns it.
- Keep commits coherent and reviewable. Stage exact paths or hunks, separate unrelated behavior, and use imperative commit subjects that describe what the commit does.
- Run the repository checks covering the changed behavior before committing. Record failures honestly; never hide them by weakening checks or excluding affected files.
- Keep the working tree clean at handoff. Commit the source and documentation changed for the task. Ignore only generated, secret, machine-local, or disposable artifacts. Use narrow ignore rules; never ignore source merely to make status clean.
- Fetch before publishing, push the current branch to its configured upstream, then verify the branch is neither ahead nor behind and `git status --short` is empty.
- Preserve shared history. Do not amend, rebase, force-push, or discard unrecognized work unless the user explicitly requests it.

## Verification

Before completion, run `pnpm check`, `pnpm typecheck`, and `pnpm test`. Also run the command that exercises the changed runtime behavior.

See `package.json` for available scripts.

## Change constraints

- Read [docs/architecture.md](docs/architecture.md) before changing module boundaries, data flow, routing, transport, configuration, integrations, or authentication.
- Read [docs/research/github-api-primitives.md](docs/research/github-api-primitives.md) before writing GitHub fetch code. Follow its decisions about endpoints, authorization, rate limits, and GraphQL.
- Views read through `useRoadmap()` and never fetch directly.
- Keep navigation state only in the URL hash; do not mirror it in `useState`.
- Callers and tests must use the public `RoadmapApplication` interface, not its internals.
- Credentials remain server-side and never enter configuration, browser state, URLs, logs, health output, application state, or transport messages.
- Mark incomplete data explicitly.
