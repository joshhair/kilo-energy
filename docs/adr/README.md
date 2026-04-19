# Architecture Decision Records

Short write-ups of the why behind load-bearing decisions. Read these
before proposing changes to the underlying pattern — often the
decision encodes context you don't have.

Format per record: Context → Decision → Alternatives considered →
Consequences. Date-stamped. Immutable once published; superseded by
new ADRs (numbered forward) that reference the original.

## Index

- [001 — Integer cents for money](001-integer-cents.md)
- [002 — Server-authoritative commission math](002-server-auth-commission.md)
- [003 — Turso (libSQL) for the production database](003-turso.md)
- [004 — Clerk for authentication](004-clerk.md)
- [005 — Field-visibility matrix for RBAC scrubbing](005-field-visibility-matrix.md)
- [006 — Separate desktop + mobile files, shared logic](006-parallel-mobile-files.md)
