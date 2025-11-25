import React from "react";

export default function TermsOfService() {
  return (
    <div className="policy-page p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold">Terms of Service — Purple Music</h1>
      <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>

      <h2 className="text-xl font-semibold mt-4">1. Acceptance of Terms</h2>
      <p>
        These Terms of Service ("Terms") govern your access to and use of Purple Music (the "Service"). By creating an account,
        accessing, or using the Service, you agree to be bound by these Terms and by our <a className="text-primary underline" href="/privacy">Privacy Policy</a>.
        If you do not agree, do not use the Service.
      </p>

      <h2 className="text-xl font-semibold mt-4">2. Service Description</h2>
      <p>
        Purple Music provides a music discovery and playback experience using the official YouTube IFrame Player. Content is streamed
        directly from YouTube; Purple Music does not host or store audio/video files. The Service also integrates the Pi Network SDK for
        authentication and payments and uses Supabase for data storage and account management.
      </p>

      <h2 className="text-xl font-semibold mt-4">3. Third‑Party Platform Terms</h2>
      <ul className="list-disc pl-6">
        <li>
          YouTube: All playback uses the visible YouTube IFrame Player with controls enabled. No background playback, no content
          modification, and no downloading. Use of YouTube content is subject to Google’s Terms of Service and YouTube API Services Terms of Service.
        </li>
        <li>
          Pi Network: Login and payments are facilitated via the Pi SDK and Pi Platform API. Your use of Pi Network is governed by the
          Pi Network Terms and policies.
        </li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">4. Accounts and Security</h2>
      <ul className="list-disc pl-6">
        <li>You must be at least 13 years old (or the minimum age required in your country) to use the Service.</li>
        <li>You are responsible for the security of your account and for all activity under it.</li>
        <li>We may suspend or terminate accounts that violate these Terms or applicable laws.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">5. Premium Plans and Payments</h2>
      <ul className="list-disc pl-6">
        <li>We offer weekly, monthly, and yearly premium plans priced in π (Pi) currency.</li>
        <li>Payments are initiated through the Pi SDK and verified server‑side via the Pi Platform API.</li>
        <li>Upon successful verification, your premium status and expiration (premium_until) are recorded in Supabase.</li>
        <li>Benefits expire automatically on the listed date unless renewed.</li>
        <li>Taxes, duties, and fees (if applicable) are your responsibility.</li>
        <li>Refunds are generally not provided once digital benefits are delivered, except where required by law.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">6. Acceptable Use</h2>
      <ul className="list-disc pl-6">
        <li>Do not attempt to download, scrape, or re‑distribute YouTube content via the Service.</li>
        <li>Do not remove or obscure YouTube controls, branding, or attributions.</li>
        <li>Do not interfere with or circumvent security, rate limits, or payment verification.</li>
        <li>Do not use the Service for unlawful, infringing, or harmful activities.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">7. User Content and IP</h2>
      <p>
        You retain any rights you have in content you add to the Service (e.g., playlist names). By submitting content, you grant us a
        non‑exclusive, worldwide, royalty‑free license to use, display, and distribute such content solely for operating and improving the Service.
        All Purple Music software, UI, and branding are our intellectual property and may not be copied or reverse engineered.
      </p>

      <h2 className="text-xl font-semibold mt-4">8. Copyright Complaints</h2>
      <p>
        We respect the rights of creators. If you believe your rights are infringed through content accessible via the Service, please
        contact us at <a className="text-primary underline" href="mailto:nikolastojadinov@yahoo.co.uk">nikolastojadinov@yahoo.co.uk</a> with sufficient detail (links, screenshots, and your contact information).
      </p>

      <h2 className="text-xl font-semibold mt-4">9. Privacy</h2>
      <p>
        We collect and process limited personal data to provide the Service. For details, see our
        <a className="text-primary underline" href="/privacy"> Privacy Policy</a>.
      </p>

      <h2 className="text-xl font-semibold mt-4">10. Disclaimers</h2>
      <ul className="list-disc pl-6">
        <li>The Service is provided "as is" and "as available" without warranties of any kind.</li>
        <li>
          We do not control availability or behavior of third‑party platforms (e.g., YouTube, Pi Network, Supabase) and are not responsible for
          their outages, policy changes, or content removals.
        </li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">11. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Purple Music and its affiliates are not liable for any indirect, incidental, special,
        consequential, or punitive damages, or any loss of profits or data, arising from your use of the Service.
      </p>

      <h2 className="text-xl font-semibold mt-4">12. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Purple Music from any claims, liabilities, damages, losses, and expenses
        (including reasonable attorneys’ fees) arising out of or in any way connected with your use of the Service or violation of these Terms.
      </p>

      <h2 className="text-xl font-semibold mt-4">13. Changes to the Service or Terms</h2>
      <p>
        We may modify the Service or these Terms at any time. Material changes will be posted at
        <a className="text-primary underline" href="/terms"> /terms</a>. Continued use after changes become effective constitutes acceptance.
      </p>

      <h2 className="text-xl font-semibold mt-4">14. Termination</h2>
      <p>
        We may suspend or terminate your access immediately for violations of these Terms or legal requirements. You may stop using the
        Service at any time. Sections that by their nature should survive termination will survive (e.g., IP, disclaimers, liability limits).
      </p>

      <h2 className="text-xl font-semibold mt-4">15. Governing Law</h2>
      <p>
        These Terms are governed by the laws applicable in your place of residence unless mandatory law requires otherwise. Any dispute
        will be brought in the competent courts having jurisdiction over your residence, unless a different venue is required by law.
      </p>

      <h2 className="text-xl font-semibold mt-4">16. Contact</h2>
      <p>
        Questions about these Terms? Email us at
        <a className="text-primary underline" href="mailto:nikolastojadinov@yahoo.co.uk"> nikolastojadinov@yahoo.co.uk</a>.
      </p>
    </div>
  );
}
