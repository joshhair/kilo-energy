Run a comprehensive code quality and integrity review of the Kilo Energy app.

## Review checklist

### 1. Type safety
Run `npx tsc --noEmit` and report any type errors.

### 2. Tests
Run `npm test` and report results. Flag any failing tests.

### 3. Lint
Run `npm run lint` and report any warnings or errors.

### 4. API security audit
Check all API routes in `app/api/` for:
- DELETE endpoints must use `requireAdmin()` not just `requireAuth()`
- POST/PATCH endpoints that modify sensitive data (payroll, pricing) must use `requireAdmin()`
- No raw SQL or unsanitized user input in queries

### 5. Business logic integrity
Verify key business rules are correctly implemented:
- Commission calculation: `max(0, (netPPW - baseline) × kW × 1000)`
- Setter baseline = closer + $0.10/W
- M1 cutoff Sunday 11:59 PM, M2 cutoff Saturday 11:59 PM, both paid following Friday
- installPayPct determines M2/M3 split

### 6. Data consistency
Check the local dev.db for:
- Orphaned payroll entries (referencing deleted projects)
- Projects with invalid installer/financer references
- Duplicate user emails

### 7. UI/UX issues
Scan for common problems:
- Missing loading states on async operations
- Missing error handling on fetch calls
- Confirm dialogs on destructive actions (delete, cancel)

## Output
Provide a summary with:
- PASS / FAIL for each section
- Specific issues found with file:line references
- Priority ranking (critical / warning / info)
