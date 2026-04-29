# Baselines / Pricing — threat model

Brief STRIDE analysis for the pricing-data surface. Reviewed quarterly (next: 2026-07).

---

## Why pricing data is sensitive

`kiloPerW` (company cost) and `subDealerPerW` (sub-dealer payout rate) collectively reveal Kilo's margin structure — a competitive moat. Tier values for closer/setter are visible to reps via their commission display, so those are NOT admin-only. The asymmetry is intentional: reps need to forecast their pay; nobody outside admin needs to see margin.

Closer/setter tier values are still sensitive in aggregate (cross-deal trends, comparison across installers), so write-side controls protect them too.

---

## Categories + mitigations

### 1. Confidentiality (Information Disclosure)

| Threat | Mitigation | Status |
|---|---|---|
| Rep / sub-dealer / trainer sees `kiloPerW` via API payload | Privacy gate (`lib/db-gated.ts`) scopes queries; serializer scrubs (`lib/serialize.ts`); middleware response scrubber (PR A) | Layered |
| Vendor PM sees other installers' products | `scopedInstallerId` filter at query layer; refused at route layer for explicit-id paths | PR A |
| `kiloPerW` leaks via UI rendering even when API correctly omits | E2E DOM check per role (Playwright) | PR A |
| New code path bypasses scrubber by reading prisma directly | `no-restricted-imports` lint rule already in place; sensitivity-coverage CI gate added (PR S) | Active |
| Pricing leaks into Vercel logs / Sentry | Logger redacts `kiloPerW`/`tier`/`amount` keys by default (PR S) | Active |

### 2. Integrity (Tampering)

| Threat | Mitigation | Status |
|---|---|---|
| CSRF: malicious site forces admin's browser to mutate pricing | Origin/Referer validation in middleware on every mutation (already shipped) | Active |
| Session-cookie theft → unauthorized writes | Step-up auth required on sensitive ops (bulk, retroactive, hard-delete) (PR S) | PR S |
| Race conditions: two admins editing same product concurrently | Optimistic concurrency check via `updatedAt` ETag; client refused on stale value (PR C) | PR C |
| SQL injection in tier values | Prisma is parameterized; Zod validation on every endpoint | Active |
| Supply-chain attack via npm package | Pinned versions; `npm audit` in CI; renovate-bot for controlled upgrades | Active |
| Admin role demoted mid-request (TOCTOU) | Role re-checked at the DB-write boundary in `requireAdmin()` per request | Active |

### 3. Audit / Non-repudiation (Repudiation)

| Threat | Mitigation | Status |
|---|---|---|
| Admin denies making a change | Every mutation writes AuditLog with actor + before/after | Active |
| Admin tampers with audit history | DB-level append-only via ESLint allowlist (`auditLog.update`/`auditLog.delete` blocked outside retention + erase) (PR S) | PR S |
| Audit log read by unauthorized parties | `requireAdmin()` on AuditLog read endpoints | Active |

### 4. Availability (Denial of Service)

| Threat | Mitigation | Status |
|---|---|---|
| Bulk operation accidentally zeros out all prices | Diff preview + magnitude guard (require extra confirm for large ops) + 30-second undo (PR E) | PR E |
| Cron / scheduled activation misfires | No cron used — versioning works via date-range query at lookup time. UI label staleness only (cosmetic). | Resolved |
| Restore from backup is broken | Backup verified before sensitive ops; restore script tested in staging | Operational |
| Rate-limit DoS by single bad actor | Per-IP global limit + per-actor mutation budget | Active |

### 5. Business-logic abuse

| Threat | Mitigation | Status |
|---|---|---|
| Backdated effective date rewrites paid commissions | Past dates hard-blocked; retroactive override requires extra confirmation (PR F) | PR F |
| Soft-delete + restore manipulates which version applies | Restore action audit-logged with reason; cascade analysis before archive (PR D) | PR D |
| Version deleted while a project references it | Pre-delete dependency check refuses if any project FK exists (PR D) | PR D |

### 6. Insider threat

| Threat | Mitigation | Status |
|---|---|---|
| Admin sets prices to favor a specific rep | Audit log captures who/what/when; structured-event emission (PR S) for forensic review | Logged |
| Admin shares credentials | Step-up auth requires fresh re-authentication (10-min window) for sensitive ops | PR S |
| Mass-edits during anomalous hours | Phase 1 logging via `lib/anomaly-detector.ts` (events captured; no alerting yet) | PR S |

---

## Explicit residual risks (accepted)

- **No two-person approval for any operation.** At current team size (2-3 admins), two-person rule is operational friction without proportional security benefit. Re-evaluate at >5 admins.
- **No hash-chain audit log.** DB-level append-only enforcement (via ESLint + retention/erase allowlist) covers the threat we have. Hash chain matters at SOC 2 / legal-evidence-grade auditing, which we don't need yet.
- **No off-site audit-log replica.** Turso's existing backup mechanism covers disaster recovery. Add when retention requirements demand it.
- **Anomaly detection is logging-only (Phase 1).** Phase 2 (alerts) requires a 60-day baseline to avoid false positives at small admin counts. Phase 3 (blocking) is a future evolution.

## Review cadence

- Quarterly review: 2026-07, 2026-10, 2027-01, 2027-04.
- Any new admin role / scaling event: ad-hoc review.
- Any incident touching pricing data: post-incident review + threat-model update.

## Owner

Internal admin team (Josh + Jarvis). Audit log + anomaly events reviewed when incidents arise; otherwise continuous via observability pipeline.
