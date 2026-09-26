# Changesets

Packages under `packages/*` are versioned with [changesets](https://github.com/changesets/changesets).

- Add a changeset in any PR that changes a published package: `npm run changeset`.
- On merge to `main`, the Publish workflow opens a "Version Packages" PR that bumps versions and writes changelogs.
- Merging that PR publishes to npm with `--provenance` via GitHub OIDC.
- If the OpenAPI spec has breaking changes (`oasdiff`), the workflow fails unless a `major` changeset exists for the client and SDK.
