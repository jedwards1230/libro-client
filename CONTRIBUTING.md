# Contributing to libro-client

libro-client is a Bun-based CLI and background service that downloads audiobooks from the Libro.fm API, tracks local state, and runs either interactively or in automated service mode. All changes go through the workflow below.

## Prerequisites

- [Bun](https://bun.sh) — runtime and bundler (no Node.js required for the app itself).
- Docker — only needed to build/run the container image.

The repository ships a devcontainer (`.devcontainer/`) with the full toolchain preinstalled — opening the repo in it is the quickest way to get a working environment.

## Build, test & lint

```bash
bun install              # install dependencies (CI uses --frozen-lockfile)
bun test                 # run the test suite (this is the gate CI enforces)
bunx tsc --noEmit        # type-check (strict mode, no emit)
bun run build:cli        # build the standalone binary -> bin/libro
bun run build:docker     # build the Docker image
```

CI runs `bun test` only — type-checking and the builds above are local checks, so run them yourself before pushing.

## Documentation

Keep documentation current as part of the change, not as a follow-up — update the README and any affected docs in the same PR.

## Before you open a PR

- Run the test suite (`bun test`) and the type-checker (`bunx tsc --noEmit`) locally first.
- Run `pre-commit run --all-files` (this repo uses pre-commit hooks).

## Branching & commits

- Branch off `main`; never commit directly to `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, …).
- Sign your commits where possible (`git commit -S`).
- Keep each PR focused; delete dead code rather than commenting it out.

## Pull requests

- Open the PR against `main`.
- Every PR runs CI. Resolve **all** review threads before the PR is merged.
- An automated code review runs on each PR; address and resolve its threads like any other review.
- A PR can be merged once CI is green and all review threads are resolved.

## Releases

Releases are cut automatically when a PR is merged to `main`. The release workflow reads the merged PR's `semver:*` label to decide the bump: `semver:minor` or `semver:major` bump accordingly, and any other merge (including unlabeled) defaults to a **patch** bump. Add the `skip-release` label to a PR to opt out of a release entirely.

A release tags `vX.Y.Z`, builds and pushes the multi-arch Docker image (`jedwards1230/libro:<version>` and `:latest`), generates AI release notes, and publishes the GitHub Release. Publishing the Release then triggers a separate workflow that publishes the `libro-client` package to npm via Trusted Publishing (OIDC). The git tag is authoritative — `package.json` is bumped at build time to match it and is never committed back to `main`.
