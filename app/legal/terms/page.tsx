export const metadata = { title: 'Terms of Service | Kilo Energy' };

const LAST_UPDATED = '2026-04-15';

export default function TermsPage() {
  return (
    <>
      <h1 className="text-3xl font-black text-white mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
        Terms of Service
      </h1>
      <p className="text-sm text-white/50 mb-8">Last updated {LAST_UPDATED}</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">1. The service</h2>
      <p>
        Kilo Energy provides a workspace for solar sales teams to track deals, calculate commissions, and run payroll.
        Access is granted by your workspace admin via invitation.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">2. Your account</h2>
      <p>
        You are responsible for the security of your authentication credentials. Sharing your account is prohibited.
        We may suspend accounts that show signs of compromise.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul className="list-disc pl-6 space-y-1 my-3">
        <li>Reverse-engineer, decompile, or attempt to extract source code from the service.</li>
        <li>Use the service to store unrelated personal data, illegal content, or malware.</li>
        <li>Probe or scan the service for vulnerabilities without prior written permission.</li>
        <li>Submit false information about deals, customers, or commissions to manipulate payroll.</li>
      </ul>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">4. Data ownership</h2>
      <p>
        Your workspace admin owns the records created in the workspace. We process them on the workspace&apos;s behalf as
        described in the <a href="/legal/privacy" className="text-emerald-400 hover:underline">Privacy Policy</a>.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">5. Commission calculations</h2>
      <p>
        Commission and payroll figures shown in the app are computed from the data you and your team enter, using the
        configured installer pricing, financer rules, and trainer override schedules. The service is a calculator and
        ledger — actual payments are issued by your workspace, not by Kilo Energy. You are responsible for verifying
        amounts before disbursing payroll.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">6. Service changes</h2>
      <p>
        We may update features, fix bugs, and ship improvements continuously. We will not remove material functionality
        that you depend on without reasonable notice.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">7. Termination</h2>
      <p>
        Your admin can deactivate your account at any time. You can request erasure as described in the Privacy Policy.
        We may suspend or terminate accounts that violate these terms.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">8. Disclaimer</h2>
      <p>
        The service is provided &ldquo;as is.&rdquo; We make no warranty of merchantability or fitness for a particular purpose.
        We are not liable for indirect, incidental, or consequential damages, or for amounts exceeding the fees paid for
        the service in the prior 12 months.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">9. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California, without regard to conflict-of-law principles.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-3">10. Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:legal@kiloenergies.com" className="text-emerald-400 hover:underline">legal@kiloenergies.com</a>
      </p>
    </>
  );
}
