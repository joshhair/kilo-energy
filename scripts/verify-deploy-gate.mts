/**
 * verify-deploy-gate.mts — confirms the GitHub branch protection
 * rules that gate Vercel production deploys are actually configured.
 *
 * What it checks:
 *   1. `main` branch has branch protection enabled.
 *   2. Required status checks include the CI `verify` job.
 *   3. `require_branches_to_be_up_to_date` is true (prevents stale
 *      merges from slipping past a fresh CI run).
 *
 * What it does NOT check:
 *   - Vercel's "Wait for Checks" toggle (no Vercel public API for this;
 *     operator-verified manually via dashboard).
 *
 * Run before any risky release / when onboarding a new repo:
 *   GITHUB_TOKEN=ghp_xxx OWNER=joshhair REPO=kilo-energy \
 *     npx tsx scripts/verify-deploy-gate.mts
 *
 * Exits 0 if all checks pass, non-zero otherwise. Suitable for
 * scripted pre-release verification.
 */

const OWNER = process.env.OWNER ?? 'joshhair';
const REPO = process.env.REPO ?? 'kilo-energy';
const BRANCH = process.env.BRANCH ?? 'main';
const REQUIRED_CHECK = process.env.REQUIRED_CHECK ?? 'verify';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN env var required.');
  console.error('Create one at https://github.com/settings/tokens with `repo` scope.');
  process.exit(2);
}

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

type ProtectionResponse = {
  required_status_checks?: {
    strict?: boolean;
    contexts?: string[];
  } | null;
};

async function ghGet(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} returned ${res.status}: ${body}`);
  }
  return res.json();
}

type CheckResult = { label: string; ok: boolean; detail: string };

async function checkBranchProtection(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  let protection: ProtectionResponse;
  try {
    protection = (await ghGet(`/branches/${BRANCH}/protection`)) as ProtectionResponse;
  } catch (err) {
    // 404 means no protection at all
    return [{
      label: 'Branch protection exists',
      ok: false,
      detail: `${BRANCH} has no protection rule configured. ${(err as Error).message}`,
    }];
  }

  results.push({
    label: 'Branch protection exists',
    ok: true,
    detail: `${BRANCH} has a protection rule.`,
  });

  const rsc = protection.required_status_checks;
  results.push({
    label: 'Required status checks enabled',
    ok: !!rsc,
    detail: rsc
      ? `required_status_checks present`
      : 'required_status_checks is missing — status checks are not gating merges.',
  });

  if (rsc) {
    const contexts = rsc.contexts ?? [];
    const hasRequired = contexts.includes(REQUIRED_CHECK);
    results.push({
      label: `CI check "${REQUIRED_CHECK}" is required`,
      ok: hasRequired,
      detail: hasRequired
        ? `present in required contexts (${contexts.length} total)`
        : `missing. Current required contexts: ${contexts.length ? contexts.join(', ') : '(none)'}`,
    });

    results.push({
      label: 'Require up-to-date branches',
      ok: !!rsc.strict,
      detail: rsc.strict
        ? 'strict=true — branches must be current before merge'
        : 'strict=false — stale branches can merge; a fresh CI run is not guaranteed',
    });
  }

  return results;
}

async function main() {
  console.log(`Verifying deploy gate for ${OWNER}/${REPO}@${BRANCH}`);
  console.log(`Required status check: ${REQUIRED_CHECK}`);
  console.log('');

  const results = await checkBranchProtection();

  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? '✔' : '✘';
    console.log(`${mark} ${r.label}`);
    console.log(`  ${r.detail}`);
    if (!r.ok) allOk = false;
  }

  console.log('');
  if (allOk) {
    console.log('Deploy gate verified.');
    console.log('Reminder: also confirm Vercel → Project → Git → "Wait for Checks" is enabled (no API; dashboard only).');
    process.exit(0);
  } else {
    console.log('Deploy gate HAS GAPS. See docs/runbooks/deploy-gating.md for setup.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(3);
});
