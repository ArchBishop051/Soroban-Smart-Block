# Print-Friendly Detail Views & Certified PDF Audit Reports (Issue #805)

## 1. Overview & Rationale

Soroban Smart Block Explorer provides institutional-grade auditability for decentralized applications running on Soroban and the Stellar network. In compliance, forensic accounting, tax audits, and legal discovery contexts, developers and auditors require immutable, print-ready records of contract states, executed events, and cross-contract call traces.

This feature provides:
1. **Responsive Print Stylesheet (`@media print`)**: Clean, ink-efficient A4 portrait formatting that eliminates UI chrome (navigation bars, search drawers, interactive buttons) and enforces strict page-break boundaries.
2. **Pure Tagged PDF 1.7 Generation Engine**: A deterministic PDF compiler with zero native binary or headless browser dependencies, guaranteeing byte-level determinism across platforms.
3. **Cryptographic Integrity & Detached Verification**: Every generated report embeds a SHA-256 payload digest and an optional HMAC-SHA256 signature, allowing independent mathematical verification against live or archived ledger data.
4. **Resilient Reorg Handling**: Superseded events resulting from ledger reorganizations are prominently stamped with warning banners and diagonal watermarks while retaining their historical audit trail.

---

## 2. Architecture & Engine Design

```
                                ┌────────────────────────────────────────────────┐
                                │          Indexer / Compliance Service          │
                                └───────────────────────┬────────────────────────┘
                                                        │
                    ┌───────────────────────────────────┴───────────────────────────────────┐
                    ▼                                                                       ▼
    ┌───────────────────────────────┐                                       ┌───────────────────────────────┐
    │   Canonical Data Normalizer   │                                       │   Deterministic PDF Engine    │
    │  (RFC 8785 Canonical JSON)    │                                       │     (Tagged PDF 1.7 Spec)     │
    └───────────────┬───────────────┘                                       └───────────────┬───────────────┘
                    │                                                                       │
                    ▼                                                                       ▼
    ┌───────────────────────────────┐                                       ┌───────────────────────────────┐
    │   SHA-256 Digest & HMAC Sign  │ ── Verification Hash & Signature ──►  │ Multi-page Tagged Layout     │
    │ (Audit footer + API response) │                                       │ (Accessibility + Pagination)  │
    └───────────────────────────────┘                                       └───────────────┬───────────────┘
                                                                                            │
                                                                                            ▼
                                                                            ┌───────────────────────────────┐
                                                                            │   Deterministic Binary PDF    │
                                                                            │ (A4 portrait, xref table)     │
                                                                            └───────────────────────────────┘
```

### Pure JavaScript Tagged PDF 1.7 Compiler
Unlike approaches relying on Puppeteer or headless Chromium (which introduce heavy binaries, render nondeterminism, and high memory footprints), our PDF writer directly generates standard PDF 1.7 bytecode:
- **Fonts**: Standard Type-1 PostScript font metrics (`Helvetica`, `Helvetica-Bold`, `Courier`, `Courier-Bold`).
- **Accessibility / Tagged PDF**: Emits `/MarkInfo << /Marked true >>`, `/StructTreeRoot`, and hierarchical `/StructElem` objects complying with PDF/UA accessibility standards.
- **Dynamic Multi-page Flow**: Automatically breaks content across pages when remaining printable height drops below 85 points.
- **Xref Stability**: Byte offsets in the `xref` table and trailer dictionary are calculated deterministically.

---

## 3. Cryptographic Verification & Canonical Data

### Canonicalization & Hashing
To prevent subtle JSON key ordering or whitespace discrepancies from invalidating audit checks, data structures are normalized using RFC 8785 canonicalization:

```javascript
import { computeReportHash, verifyReport } from "../reports/signer.js";

const canonicalData = {
  seq: 1042,
  ledger: 543210,
  contract_id: "CAAA...DD",
  function: "transfer",
  tx_hash: "0123...cdef",
};

const hash = computeReportHash(canonicalData);
// Returns standard lowercase 64-char hex SHA-256 digest
```

### Independent Offline Verification via CLI
Auditors can verify an exported report independently using standard Unix tools without relying on the explorer frontend:

```bash
# 1. Fetch canonical JSON for event #1042
curl -s "https://soroban-explorer.stellar.org/api/events/1042" \
  | jq -S "walk(if type == \"object\" then to_entries | sort_by(.key) | from_entries else . end)" \
  | shasum -a 256

# 2. Compare the output hash against the "Report Verification Hash" in the PDF footer box.
```

---

## 4. API Endpoints

### 1. Single Event PDF Audit Report
- **Route**: `GET /api/reports/event/:seq`
- **Parameters**: `seq` (integer) — Event sequence number.
- **Response**: Binary `application/pdf` stream with `Content-Disposition: attachment; filename="soroban-event-:seq-audit.pdf"`.
- **Response Headers**:
  - `X-Report-Hash`: SHA-256 hex digest of the canonical event data.
  - `X-Report-Signature`: Detached HMAC-SHA256 signature.

### 2. Smart Contract Audit Report
- **Route**: `GET /api/reports/contract/:id`
- **Parameters**: `id` (string) — 56-character Stellar contract address (`C...`).
- **Response**: Binary `application/pdf` report containing registered metadata, ABI versioning, and function interface breakdown.

### 3. Batch Event Audit Report
- **Route**: `POST /api/reports/batch`
- **Body**: `{ "events": [ { ... }, ... ] }` (Maximum 100 events).
- **Response**: Multi-page PDF report with executive summary table followed by sequential event pages.

### 4. Cryptographic Report Verifier
- **Route**: `POST /api/reports/verify`
- **Body**:
  ```json
  {
    "data": { "seq": 1042, "ledger": 543210 },
    "expected_hash": "a1b2c3d4e5f6...",
    "signature": "optional HMAC hex"
  }
  ```
- **Response**:
  ```json
  {
    "verified": true,
    "computed_hash": "a1b2c3d4e5f6...",
    "algorithm": "SHA-256",
    "signature_verified": true
  }
  ```

---

## 5. Web Print Mode (`@media print`)

The print stylesheet (`frontend/src/styles/print.css`) optimizes paper and browser print output:
- **A4 Portrait Page Box**: Margin calibrated to `14mm 12mm 14mm 12mm`.
- **Chrome Suppression**: Hides navigation header, search bars, drawer overlays, wallet connect buttons, and developer workspace links.
- **Page Break Avoidance**: Cards, tables, and invocation trees apply `break-inside: avoid` and `page-break-inside: avoid` to eliminate awkward split rows.
- **Watermark Presentation**: Events marked as superseded by a ledger reorg prominently render a dashed red warning banner and watermark.
- **Print Header & Footer**: Injects explorer identification, generation timestamp, and live permalink at page margins.
