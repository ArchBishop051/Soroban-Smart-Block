# Vulnerability Triage Runbook

Applies to reports received via GitHub private vulnerability reporting
(Settings → Code security → Private vulnerability reporting must be enabled).

## 1. Intake (≤ 3 business days)

1. Acknowledge the reporter on the draft advisory.
2. Assign an owner and add the maintainers who own the affected component.
3. Reproduce on `main`. If not reproducible, ask the reporter for details.

## 2. Severity

Score with **CVSS v4.0** and record the vector on the advisory.

| Severity | CVSS v4 | Fix target |
|----------|---------|------------|
| Critical | 9.0–10.0 | 14 days |
| High | 7.0–8.9 | 30 days |
| Medium | 4.0–6.9 | 90 days |
| Low | 0.1–3.9 | Next release |

## 3. Fix

- Develop the fix in the advisory's temporary private fork.
- Add a regression test.
- Request a CVE from GitHub for medium or higher.

## 4. Disclosure timeline

| Day | Action |
|-----|--------|
| 0 | Report received |
| ≤ 3 | Acknowledged |
| ≤ 7 | Triaged + severity agreed with reporter |
| Fix target | Patched release published |
| Release + 7 (max. day 90) | Advisory published, reporter credited (if desired) |

## 5. Third-party dependency reports

1. Confirm whether our usage is actually exploitable.
2. Forward to the upstream maintainer's security contact, and link the upstream
   report on our advisory.
3. If exploitable, mitigate locally (pin, patch, disable feature) and track it
   like any other finding. If not, close with rationale.

## 6. security.txt maintenance

`frontend/public/.well-known/security.txt` and the `/.well-known/security.txt`
route in `indexer/src/api.js` must stay in sync. Renew `Expires` before it
lapses (at most one year ahead, per RFC 9116).
