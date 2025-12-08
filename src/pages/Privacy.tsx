import React from "react";

export default function Privacy() {
  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "960px",
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1>Privacy Policy — Purple Music</h1>
      <p>Last updated: December 8, 2025</p>

      <section>
        <h2>1. Overview</h2>
        <p>
          Purple Music is a music discovery and streaming interface that integrates the official YouTube
          IFrame Player, the Pi Network SDK for authentication and Pi payments, and Supabase as the
          database and storage layer. Purple Music does not host or store audio or video files; every
          playback stream comes directly from YouTube. The app operates in compliance with the Pi Network
          Developer Terms of Use, YouTube API Services Terms of Service, Google Privacy Policy, and GDPR
          principles.
        </p>
      </section>

      <section>
        <h2>2. Data We Collect</h2>

        <h3>2.1 Pi Network Data</h3>
        <ul>
          <li>Pi username</li>
          <li>Pi wallet address</li>
          <li>Signed authentication payloads (verified server-side only)</li>
        </ul>
        <p>Purple Music never receives or stores Pi passwords, private keys, or other Pi login credentials.</p>

        <h3>2.2 App Preference Data</h3>
        <ul>
          <li>Language</li>
          <li>Region</li>
          <li>UI or session configuration such as preferred tab or layout</li>
        </ul>

        <h3>2.3 Subscription Data</h3>
        <ul>
          <li>Premium plan type</li>
          <li>Premium expiration timestamp (premium_until)</li>
        </ul>

        <h3>2.4 Usage and Technical Data</h3>
        <ul>
          <li>Track plays, likes, and playlist interactions</li>
          <li>Basic technical logs such as IP address, device type, browser or user agent, and timestamps</li>
        </ul>
        <p>
          This information is used only for security, debugging, abuse prevention, and aggregate statistics—not
          for advertising or profiling. Purple Music does not intentionally collect sensitive categories of
          data.
        </p>
      </section>

      <section>
        <h2>3. How We Use Your Data</h2>
        <p>Collected data is used solely to:</p>
        <ul>
          <li>Authenticate users through the Pi Network SDK</li>
          <li>Verify Pi payments and manage premium status</li>
          <li>Load playlists and track metadata across devices</li>
          <li>Improve stability, performance, and security</li>
          <li>Comply with Pi Network ecosystem rules and applicable law</li>
        </ul>
        <p>Purple Music does not sell user data and does not share data with advertising networks.</p>
      </section>

      <section>
        <h2>4. YouTube API Compliance</h2>
        <ul>
          <li>All playback uses the visible YouTube IFrame Player with controls enabled (controls=1) and YouTube branding visible.</li>
          <li>Purple Music does not allow downloading, scraping, recording, or modifying YouTube content.</li>
          <li>No background or lock-screen playback is provided for YouTube streams.</li>
          <li>Only public metadata from the YouTube Data API—such as titles, thumbnails, durations, and IDs—is stored in Supabase.</li>
          <li>
            Use of YouTube content is governed by the YouTube Terms of Service, YouTube API Services Terms of
            Service, and Google Privacy Policy.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Pi Network SDK &amp; Developer Terms Compliance</h2>
        <ul>
          <li>Purple Music processes only signed authentication payloads provided by Pi Browser and verifies them on the backend.</li>
          <li>The app does not store Pi passwords or login credentials and does not share Pi user data with unauthorized third parties.</li>
          <li>The Pi-related integration logic is provided under the PiOS License as required by Section 5 of the Pi Network Developer Terms of Use.</li>
        </ul>
      </section>

      <section>
        <h2>6. Data Storage and Retention</h2>
        <ul>
          <li>Data is stored in Supabase with encryption at rest and secure access controls.</li>
          <li>Temporary logs and test accounts are periodically deleted.</li>
          <li>Premium subscription records are retained until the membership expires or deletion is requested.</li>
          <li>Where possible, data is anonymized or aggregated for analytics.</li>
        </ul>
      </section>

      <section>
        <h2>7. Your Rights</h2>
        <p>Users may exercise the following rights:</p>
        <ul>
          <li>Request access to their personal data</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of personal data, subject to legal obligations</li>
          <li>Ask questions about how their data is used</li>
        </ul>
        <p>
          Contact: <a href="mailto:nikolastojadinov@yahoo.co.uk">nikolastojadinov@yahoo.co.uk</a>. Requests will be answered within 30 days.
        </p>
      </section>

      <section>
        <h2>8. Changes to This Policy</h2>
        <p>
          Future changes to this Privacy Policy will be posted on this page with an updated "Last updated"
          date. Continued use of Purple Music after changes are published constitutes acceptance of the
          updated policy.
        </p>
      </section>
    </main>
  );
}
