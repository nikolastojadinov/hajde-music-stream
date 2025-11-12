import React from "react";

export default function PrivacyPolicy() {
  return (
    <div className="policy-page p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold">Privacy Policy — Purple Music</h1>
      <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>

      <h2 className="text-xl font-semibold mt-4">1. Overview</h2>
      <p>
        Purple Music is a music streaming app integrating YouTube IFrame Player, Pi Network SDK login and payments, and Supabase database storage.
        We value user privacy and operate under GDPR and Pi Network Developer Terms.
      </p>

      <h2 className="text-xl font-semibold mt-4">2. Data We Collect</h2>
      <ul className="list-disc pl-6">
        <li>Pi Network username and wallet address</li>
        <li>Session preferences (language, region)</li>
        <li>Premium subscription details (plan and expiration)</li>
        <li>Anonymous usage data (track plays, likes, etc.)</li>
      </ul>

      <h2 className="text-xl font-semibold mt-4">3. Use of Data</h2>
      <p>
        Data is used to enable login, playlist sync, premium billing, and music recommendations.
        We never sell user data to third parties.
      </p>

      <h2 className="text-xl font-semibold mt-4">4. YouTube API Compliance</h2>
      <p>
        All playback occurs via visible YouTube IFrame Player with controls enabled (controls=1, logo visible).
        We store only public metadata from YouTube API v3 and fully respect Google’s Terms of Service.
      </p>

      <h2 className="text-xl font-semibold mt-4">5. Pi Network SDK Integration</h2>
      <p>
        Login and payments are processed through Pi Platform SDK. No private keys or wallet credentials are ever stored on our servers.
      </p>

      <h2 className="text-xl font-semibold mt-4">6. Data Storage & Retention</h2>
      <p>
        Supabase securely stores user and playlist metadata. Test accounts and temporary data are periodically purged.
        Premium records remain until membership expires.
      </p>

      <h2 className="text-xl font-semibold mt-4">7. User Rights & Contact</h2>
      <p>
        Users can request data deletion at 
        <a href="mailto:support@purplemusic.netlify.app" className="text-primary underline"> support@purplemusic.netlify.app</a>.
        We will respond within 30 days.
      </p>
    </div>
  );
}
