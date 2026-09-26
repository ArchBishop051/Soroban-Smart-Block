# API deprecation policy

This document defines how the Soroban Smart Block Explorer API handles breaking changes, compatibility windows, and sunset timelines for the v1 API.

## Scope

This policy applies to all public HTTP endpoints and WebSocket contracts under the `v1` API surface, including documented route paths without a major-version prefix and any compatibility aliases that remain in place while the v1 contract is active.

## Versioning model

- The API follows semantic versioning.
- `v1` is the current compatibility baseline and remains the default public API surface.
- New features that are backward-compatible may be shipped in place without changing the version.
- Breaking changes must ship under a new major version path, for example `/api/v2/...`.

## Deprecation notice period

When a route or response contract is planned for removal or a breaking change is introduced:

- The deprecation must be announced in the API changelog at least 30 days before the change is enforced.
- The route or payload must remain callable for a minimum of 90 days after the deprecation notice is published.
- The response should include a deprecation header during the migration window:
  - `Deprecation: true`
  - `Sunset: <RFC 7231 date>`
  - `Link: <https://.../docs/api/deprecation-policy.md>; rel="deprecation"`

## Sunset process

1. Publish the deprecation notice in the changelog and relevant docs.
2. Update the OpenAPI schema and examples to mark the endpoint as deprecated.
3. Monitor real traffic and inform affected integrators when the endpoint is still active.
4. Keep the legacy route available until the sunset date passes.
5. Return a clear 410 or 400 response once the endpoint is retired, with a migration hint and the replacement route.

## Required migration messaging

Deprecated endpoints must include a clear migration note in the docs and the response payload when practical. Example guidance:

- “This endpoint is deprecated and will be removed on <date>.”
- “Use `/api/v2/...` instead.”
- “The previous response schema is no longer supported; see the changelog for migration guidance.”

## Enforcement

The project may retire a route only after:

- the deprecation notice has been published for the required notice period,
- the replacement endpoint is available and documented,
- the API changelog and migration notes are complete,
- and the sunset date has passed without a documented exception.

## Exceptions

Security fixes, critical bug fixes, and data-integrity issues may require a faster action. In those cases, the team will publish the migration guidance as soon as possible and apply the shortest practical notice window consistent with the security or data risk.

## Related docs

- [API changelog](./changelog.md)
- [OpenAPI spec](./openapi.yaml)
