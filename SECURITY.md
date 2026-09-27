# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/security/advisories/new).
Do **not** open a public issue. A machine-readable contact is published at
`/.well-known/security.txt` (RFC 9116) on both the frontend and the API.

Please include affected component and version, reproduction steps, and impact.

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` and the latest release | Yes |
| Older releases | No — upgrade first |

## Scope

In scope:

- Indexer API (REST, GraphQL, WebSocket): authentication, API-key management,
  2FA, CSRF, rate-limit bypasses, IDOR on per-key resources (webhooks, usage),
  admin routes and the admin IP allowlist, billing webhooks.
- Frontend (XSS, CSP bypass, sandbox IDE escapes).
- Smart contracts in `contracts/`: admin keys, upgrade/pause authority, and
  ABI-registry squatting.
- Container images and CI/CD supply chain (signatures, provenance).

Out of scope: volumetric DoS, social engineering, findings requiring a
compromised host or browser, missing best-practice headers without impact, and
vulnerabilities in third-party dependencies (see below).

## Response targets

| Stage | Target |
|-------|--------|
| Acknowledgement | 3 business days |
| Triage + severity (CVSS v4) | 7 days |
| Fix — critical / high | 14 / 30 days |
| Fix — medium / low | 90 days / next release |
| Coordinated disclosure | After fix is released, or 90 days from report |

## Safe harbor

We will not pursue legal action against good-faith research that follows this
policy: avoid privacy violations, data destruction, and service degradation;
only access data you own or that you need to demonstrate the issue; stop and
report as soon as you confirm a vulnerability; and give us reasonable time to
fix before disclosure.

## Third-party dependencies

Issues in upstream packages should be reported to the upstream maintainers. If
you report one to us, we will forward it upstream and track our exposure — see
[docs/security/triage-runbook.md](docs/security/triage-runbook.md).
