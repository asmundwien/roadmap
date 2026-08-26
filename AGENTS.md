# Agent Instructions

## Git hygiene

- Check `git status --short --branch` before editing and before handoff. Treat every pre-existing change as user work; preserve it unless the task explicitly owns it.
- Keep commits coherent and reviewable. Stage exact paths or hunks, separate unrelated behavior, and use imperative commit subjects that describe the delivered outcome.
- Run the repository checks covering the changed behavior before committing. Record failures honestly; never hide them by weakening checks or excluding affected files.
- Keep the working tree clean at handoff: commit intended source and documentation, and ignore only generated, secret, machine-local, or disposable artifacts. Use narrow ignore rules; never ignore source merely to make status clean.
- Fetch before publishing, push the current branch to its configured upstream, then verify the branch is neither ahead nor behind and `git status --short` is empty.
- Preserve shared history. Do not amend, rebase, force-push, or discard unrecognized work unless the user explicitly requests it.
