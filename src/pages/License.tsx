import React from "react";

export default function License() {
  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "900px",
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1>License — Purple Music</h1>

      <section>
        <h2>1. PiOS License Notice</h2>
        <p>
          All components of Purple Music that interact directly with the Pi Network—including Pi authentication, Pi payments, Pi session
          verification, and every portion of the Pi SDK integration logic—are made available under the PiOS License as required by Section 5
          of the Pi Network Developer Terms of Use. Pi-related integration code is licensed for use within the Pi ecosystem under the PiOS
          License. The official license text is available at <a href="https://github.com/pi-apps/PiOS" target="_blank" rel="noreferrer">https://github.com/pi-apps/PiOS</a>.
        </p>
      </section>

      <section>
        <h2>2. Proprietary Components</h2>
        <p>
          All other parts of Purple Music remain proprietary intellectual property, including the user interface and overall design, YouTube
          player integration logic, Supabase data access logic, branding elements, artwork, and any algorithms used in the Service. These
          components may not be copied, modified, or redistributed without prior written permission from Purple Music.
        </p>
      </section>

      <section>
        <h2>3. Third-Party Trademarks</h2>
        <ul>
          <li>"Pi Network" and the Pi logo are trademarks or service marks of their respective owners.</li>
          <li>"YouTube" and the YouTube logo are trademarks of Google LLC.</li>
          <li>Purple Music does not claim ownership over YouTube or Pi content.</li>
        </ul>
      </section>

      <section>
        <h2>4. Copyright</h2>
        <p>© 2025 Purple Music. All rights reserved.</p>
      </section>
    </main>
  );
}
