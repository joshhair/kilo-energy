# Kilo Energy — Runbooks

On-call playbooks for the 4 most likely production incidents.

Each doc follows the same shape:
1. **Symptoms** — what a rep/admin would see or report
2. **Diagnosis** — commands to confirm the root cause
3. **Mitigation** — fastest path to restore service
4. **Root cause** — where to look once the fire is out

| Incident | Runbook |
|---|---|
| Payroll publish silently fails | [payroll-didnt-publish.md](payroll-didnt-publish.md) |
| Commission amount is wrong | [commission-wrong.md](commission-wrong.md) |
| Database (Turso) is down or slow | [turso-down.md](turso-down.md) |
| Authentication (Clerk) is down | [clerk-down.md](clerk-down.md) |
| Restore from backup (PITR / JSON dump) | [restore-from-backup.md](restore-from-backup.md) |
| Load-test baseline + thresholds | [load-test-baseline.md](load-test-baseline.md) |
| Sentry alert rule setup | [sentry-alerts.md](sentry-alerts.md) |

Keep these short and actionable. If a runbook grows past ~100 lines, the
diagnosis flow is wrong — split it.
