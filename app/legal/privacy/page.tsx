export const metadata = { title: 'Privacy Policy | Kilo Energy' };

const LAST_UPDATED = '2026-04-15';
// Bumped when we added the self-service export/erasure endpoints and the
// explicit subprocessor list.

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-3xl font-black text-white mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
        Privacy Policy
      </h1>
      <p className="text-sm text-white/50 mb-8">Last updated {LAST_UPDATED}</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">What we collect</h2>
      <p>
        Kilo Energy is a workspace tool for solar sales teams. To make it work, we store the following about you when your
        admin invites you:
      </p>
      <ul className="list-disc pl-6 space-y-1 my-3">
        <li><strong>Identity</strong>: first and last name, email address, optional phone number, role (admin / rep / sub-dealer / project manager).</li>
        <li><strong>Activity</strong>: deals you create, edit, or are assigned to; payroll milestones; commission calculations; project notes and messages you author.</li>
        <li><strong>Authentication</strong>: a session managed by Clerk (our auth provider) that lets us recognize you across page loads.</li>
      </ul>
      <p>We do <strong>not</strong> collect: Social Security numbers, dates of birth, payment card data, banking information, or location data.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">How we use it</h2>
      <ul className="list-disc pl-6 space-y-1 my-3">
        <li>Show you your pipeline, pay, and trainer overrides.</li>
        <li>Compute commission and route payments to the correct rep at the correct milestone.</li>
        <li>Let admins manage their team and audit who changed what.</li>
        <li>Diagnose bugs and operational issues (logs are scrubbed of email and phone before storage).</li>
      </ul>
      <p>We do not sell your data, share it with advertisers, or use it to train AI models.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Where it lives (subprocessors)</h2>
      <p>
        We use the following third parties to run Kilo Energy. Each is bound by their own DPA; click through for their
        privacy policies.
      </p>
      <ul className="list-disc pl-6 space-y-1 my-3">
        <li><strong>Turso</strong> (libSQL) — application database (US region). <a href="https://turso.tech/privacy" className="text-emerald-400 hover:underline" rel="noopener noreferrer" target="_blank">Privacy policy</a>.</li>
        <li><strong>Clerk</strong> — authentication, session management, invitations. <a href="https://clerk.com/legal/privacy" className="text-emerald-400 hover:underline" rel="noopener noreferrer" target="_blank">Privacy policy</a>.</li>
        <li><strong>Vercel</strong> — hosting, serverless functions, edge routing. <a href="https://vercel.com/legal/privacy-policy" className="text-emerald-400 hover:underline" rel="noopener noreferrer" target="_blank">Privacy policy</a>.</li>
        <li><strong>Sentry</strong> — error tracking (events are PII-scrubbed before send). <a href="https://sentry.io/privacy" className="text-emerald-400 hover:underline" rel="noopener noreferrer" target="_blank">Privacy policy</a>.</li>
      </ul>
      <p>We do not send your records to any other third party.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">How long we keep it</h2>
      <p>
        Your records persist while you are an active member of a workspace. When your admin deactivates you, your record
        is retained but inactive. On verified erasure request (see below), personal identifiers are anonymized — your
        historical deal and payroll rows remain because they are required for the workspace&apos;s financial integrity,
        but no longer carry your name or contact info.
      </p>
      <p>
        Our audit log (a record of sensitive mutations) is pruned automatically after <strong>2 years</strong> via a
        scheduled job. Longer-horizon records (deals, payroll) are kept for the life of the workspace or until
        erasure.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Your rights</h2>
      <ul className="list-disc pl-6 space-y-1 my-3">
        <li>
          <strong>Access / Portability</strong>: fetch a full JSON export of your own records via{' '}
          <code className="text-emerald-300 bg-white/5 px-1.5 py-0.5 rounded">GET /api/users/&lt;your-id&gt;/export</code>
          {' '}(authenticated). Admins can export any user&apos;s records for GDPR/CCPA response.
        </li>
        <li><strong>Correction</strong>: edit your name or phone in Settings, or ask your admin.</li>
        <li>
          <strong>Erasure</strong>: email{' '}
          <a href="mailto:privacy@kiloenergies.com" className="text-emerald-400 hover:underline">privacy@kiloenergies.com</a>
          {' '}from the address on file. An admin will anonymize your record via{' '}
          <code className="text-emerald-300 bg-white/5 px-1.5 py-0.5 rounded">POST /api/users/&lt;id&gt;/erase</code>
          {' '}within 30 days. Historical financial rows are retained (tax / commission audit), but no longer attributable
          to you.
        </li>
      </ul>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Security</h2>
      <p>
        All connections use TLS. Auth tokens are httpOnly and managed by Clerk. Role-based access controls are enforced
        server-side; admins, reps, sub-dealers, and project managers only see the records and fields appropriate to their
        role. Financial mutations are recorded to an audit log.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Children</h2>
      <p>Kilo Energy is not directed at anyone under 18 and we do not knowingly collect data from children.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Changes</h2>
      <p>
        If we make material changes to this policy, we will post the updated version here and update the &ldquo;Last updated&rdquo; date.
        Continued use after changes constitutes acceptance.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@kiloenergies.com" className="text-emerald-400 hover:underline">privacy@kiloenergies.com</a>
      </p>
    </>
  );
}
