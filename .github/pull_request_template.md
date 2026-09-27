## Description

Provide a brief summary of the changes introduced by this pull request.

## Related Issues

Closes #<issue_number>

## Screenshots / Screen Recordings (if applicable)

Add visual proof of changes if they affect the user interface.

## Testing & Verification Notes

How did you test your changes? Add commands run or verification details.

## Checklist

- [ ] Code compiles and runs locally without errors.
- [ ] Running `npm run doctor` returns no environment errors.
- [ ] Format rules applied (`cargo fmt`, `npx prettier --write`).
- [ ] Linting tests passed (`npx eslint`).
- [ ] Unit tests pass successfully (`cargo test`, `npm test`).

## Security (only if this PR crosses a trust boundary)

Trust boundaries: browser ↔ API, API ↔ DB, indexer ↔ RPC/Horizon, plugins, webhooks, admin, contracts, CI/supply chain. See [`docs/security/threat-model.md`](../docs/security/threat-model.md).

- [ ] Threat model updated (data-flow diagram and/or threat rows) for new actors, data stores, external services, or network hops.
- [ ] User-influenced outbound requests go through `indexer/src/safeHttp.js`.
- [ ] New secrets are stored hashed/encrypted and never logged.
- [ ] New endpoints have auth, scopes, rate limits, and CSRF protection where cookie-authenticated.
