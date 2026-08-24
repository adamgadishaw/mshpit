// Crawler-readable public documents used by App Store Connect and by people
// who cannot (or do not want to) sign in. These pages intentionally do not run
// the Expo bundle: legal/support information must remain readable without
// JavaScript, an account, local storage, or a working API.
import {
  ANNOUNCEMENT_EMAIL_DISCLOSURE,
  MEDIA_AND_SESSION_SECURITY_DISCLOSURE,
  PRIVACY_POLICY_UPDATED,
} from "../src/domain/privacyDisclosures.mjs";

const SITE_NAME = "Pit";
export const SUPPORT_EMAIL = "support@mshpit.com";

export const PUBLIC_PAGE_PATHS = Object.freeze([
  "/privacy",
  "/terms",
  "/support",
  "/account-deletion",
]);

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const link = (label, href) => ({ label, href });

const PAGES = Object.freeze({
  "/privacy": {
    title: "Privacy policy",
    description: "How Pit collects, uses, shares, retains, and lets you control your information.",
    updated: PRIVACY_POLICY_UPDATED,
    intro: "Pit is a social service for logging concerts, rating them, and following people whose taste matches yours. We use account and activity data to operate the service, protect it from abuse, and personalize music and local-show features. This policy describes what we collect, why, and the choices you have.",
    note: "You can download or delete your account data and turn optional product analytics off from Settings.",
    sections: [
      {
        heading: "Information you give us",
        paragraphs: [
          "Account details (name, email, password, and the city you choose), your profile (bio, avatar, genres, favorite artists, and playlists), feed preferences such as Not for me, and everything you create on Pit: reviews, ratings, photos, comments, fan-club and lounge messages, direct messages, follows, and who or what you engage with.",
        ],
      },
      {
        heading: "Information we collect automatically",
        paragraphs: [
          "For signed-in accounts that have product analytics enabled, Pit records a limited, server-approved set of categorical events such as screen and feed usage, internal post impressions, opening content, time-range buckets, playback milestones, following, liking, and posting. Search usage may be counted by category and result-count range, but the words you type are not stored in product analytics. Guests are not recorded in product analytics.",
          "Like every web service, Pit receives an IP address and basic request details when a device connects. Those details may be processed briefly for security and rate limiting, but raw IP addresses are not retained in the product-analytics table.",
        ],
      },
      {
        heading: "Cookies and similar technologies",
        paragraphs: [
          "Pit uses first-party session cookies and local storage to keep you signed in, restore navigation, remember preferences, and make the app work. The embedded YouTube player can use Google or YouTube technologies under their own policies. Most browsers let you clear or block stored data, though sign-in and other features may stop working.",
        ],
      },
      {
        heading: "How we use your data",
        paragraphs: [
          "We use information to provide and secure the service; deliver your feed, messages, local discovery, recommendations, search, playback, and account support; understand aggregate feature health; develop new features; detect abuse and enforce our Terms; and communicate with you when needed.",
        ],
      },
      {
        heading: ANNOUNCEMENT_EMAIL_DISCLOSURE.heading,
        paragraphs: [...ANNOUNCEMENT_EMAIL_DISCLOSURE.paragraphs],
      },
      {
        heading: "Community photo spotlights",
        paragraphs: [
          "Concert-review photos can be shared on an artist page when you enable public photo sharing. A separate, default-off control lets you make one eligible photo available for Pit community spotlights, including the logged-out homepage. A spotlight may show your public handle plus the artist and venue. You can turn this permission off by editing the post, make the photos private, or delete the post. Pit applies account and safety checks and may remove featured content.",
        ],
      },
      {
        heading: "Advertising and profiling",
        paragraphs: [
          "Pit is designed to support an advertising-funded service, but the current first-party product analytics system is not an ad-network integration and does not send your event history or searches to advertisers. If Pit later adds third-party advertising or materially changes profiling, this policy and the relevant choices will be updated before that use begins.",
        ],
      },
      {
        heading: "How we share data",
        paragraphs: [
          "We share information with service providers that host, secure, deliver email for, and operate Pit on our behalf; with YouTube when you use the embedded player; with Deezer when Pit resolves catalogue information or your device requests preview audio; with other users according to the feature you use (for example, a public review is public while a direct message is shown to its participants); and when required by law or reasonably necessary to protect people and the service. A business transfer may include data subject to appropriate safeguards.",
        ],
      },
      {
        heading: "YouTube API Services",
        paragraphs: [
          "Pit uses YouTube API Services and an embedded YouTube player to resolve and play requested tracks. When you use the player, Google and YouTube may receive information such as your IP address, device and browser details, the video requested, and your interactions with the embedded player, and may use cookies or similar technologies according to Google's privacy practices. Pit does not receive your YouTube password or download YouTube videos.",
        ],
        links: [
          link("Google Privacy Policy", "https://policies.google.com/privacy"),
          link("YouTube Terms of Service", "https://www.youtube.com/t/terms"),
        ],
      },
      {
        heading: "Music catalogue and preview audio",
        paragraphs: [
          "Pit currently uses Deezer catalogue information and short preview links. Pit's server sends a requested artist or track name to Deezer to resolve catalogue results. When you play a preview, your device requests the audio from Deezer or its delivery network, which can receive your IP address, device and request details, and the track requested. Pit does not receive a Deezer password or download full recordings.",
        ],
        links: [link("Deezer privacy policy", "https://www.deezer.com/legal/personal-datas")],
      },
      {
        heading: "Your choices and rights",
        paragraphs: [
          "You can edit your profile, download a portable account backup, delete content, block accounts, turn product analytics off, or permanently delete your account from Settings. Turning analytics off deletes that account's existing product-event rows and prevents new ones from being recorded.",
          "Depending on where you live, additional access, correction, deletion, objection, or restriction rights may apply. Email us to make a privacy request. We may need to verify that the request belongs to you before acting on it.",
        ],
        links: [
          link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`),
          link("Account deletion instructions", "/account-deletion"),
        ],
      },
      {
        heading: "Data retention and security",
        paragraphs: [
          `Account and content data is kept while needed to operate the account and service. Raw first-party product analytics is automatically limited to a rolling 30-day period by default and is deleted earlier when you opt out or delete your account. If an artist search returns no match, the submitted artist name may remain in a bounded staff enrichment queue for up to 30 days. ${MEDIA_AND_SESSION_SECURITY_DISCLOSURE} Passwords are hashed, signed-in requests use HTTPS in production, and access is limited, but no online service can promise perfect security.`,
          "When you delete content or your account, active database records are removed or scrubbed and Pit-owned uploads are durably queued for active object-storage deletion. That cleanup retries automatically and can take additional time. Separate backup copies remain until the configured retention period ends, or longer when legally required.",
        ],
      },
      {
        heading: "Children",
        paragraphs: [
          "Pit isn't directed to children under 13 (or the minimum age in their country), and we don't knowingly collect their data. If you believe a child has created an account, contact us and we'll review the request.",
        ],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
      {
        heading: "Changes",
        paragraphs: [
          "We'll update this policy as Pit grows and will change the date above when we do. If we make material changes to how we use your data for advertising, we'll take reasonable steps to let you know.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["For privacy questions or requests, email Pit support."],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
    ],
  },
  "/terms": {
    title: "Terms and conditions",
    description: "The rules and conditions that apply when you create an account or use Pit.",
    updated: "August 2026",
    intro: "Welcome to Pit. By creating an account or using Pit you agree to these Terms and Conditions and to our Privacy policy, which explains how we collect and use your data. Please read both carefully.",
    note: "These terms form a binding agreement between you and Pit. If you don't agree with them, don't use Pit.",
    sections: [
      {
        heading: "Eligibility",
        paragraphs: ["You must be at least 13 years old (or the minimum age required in your country) to use Pit, and legally able to enter this agreement. One account per person unless we approve otherwise. Artist accounts are reviewed and verified before approval."],
      },
      {
        heading: "Your account",
        paragraphs: ["Provide accurate information at sign-up and keep it current. You're responsible for your login credentials and for all activity under your account. Tell us right away if you suspect unauthorized use. We may refuse, suspend, or reclaim usernames and accounts to protect the service or comply with the law."],
      },
      {
        heading: "Acceptable use",
        paragraphs: ["Only log and review shows you actually attended. Don't post spam, hate speech, harassment, threats, illegal content, or anyone's private information; don't impersonate others, manipulate ratings, scrape the service, interfere with its operation, or attempt to access it in unauthorized ways. You agree to follow all applicable laws while using Pit."],
      },
      {
        heading: "Your content and licence",
        paragraphs: ["You keep ownership of the reviews, photos, messages, and other content you create. By posting, you grant Pit a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, adapt, display, and distribute that content to operate, promote, and improve the service (for example in feeds, discovery surfaces, and previews). This licence ends when you delete the content or your account, except for copies retained for backups, legal reasons, or where already shared with others."],
      },
      {
        heading: "User inputs and accuracy",
        paragraphs: ["Some information on Pit is entered by users: the artists, venues, tours, alternate or former venue names (\"also known as\"), setlists, and songs attached to reviews. You agree to enter this information accurately and in good faith, only where you have a reasonable basis to believe it is correct, and not to knowingly submit false, misleading, or defamatory details. You are responsible for what you submit. Pit does not verify every user input and may correct, merge, relabel, or remove inaccurate entries. Attributions to real artists and songs are for identification and community use and do not imply any endorsement by those artists."],
      },
      {
        heading: "Advertising and the free service",
        paragraphs: ["Pit is designed to remain free and may in the future display advertising or sponsored content. Pit's current first-party product analytics is not an ad-network integration and does not send your event history or searches to advertisers. Before Pit introduces third-party advertising or materially changes how information is used for advertising, the Privacy policy and relevant choices will be updated. Sponsored content, if introduced, may appear alongside your content and others'."],
      },
      {
        heading: "Moderation and enforcement",
        paragraphs: ["Content is public when posted; the community can report it and moderators act on reports. We may remove content, limit features, or suspend or terminate accounts that break these terms or harm the community or service, and we keep a record of moderation actions. Where practical we'll explain enforcement, but we may act immediately in serious cases."],
      },
      {
        heading: "Tickets and third parties",
        paragraphs: ["Ticket links and some content point to third-party providers such as Ticketmaster. Purchases, their terms, and any issues are handled by those providers. Pit is not the seller and isn't responsible for those transactions or external sites."],
      },
      {
        heading: "YouTube playback",
        paragraphs: ["Pit uses YouTube API Services and YouTube's embedded player to find and play music videos. When you use these playback features, you also agree to be bound by YouTube's Terms of Service. YouTube controls the video, advertising, availability, and playback experience inside its player; Pit does not download or provide the underlying video content."],
        links: [link("YouTube Terms of Service", "https://www.youtube.com/t/terms")],
      },
      {
        heading: "Music catalogue and preview audio",
        paragraphs: ["Pit currently uses Deezer catalogue information and links to short preview recordings. Preview availability and the underlying content are controlled by Deezer and its right holders; Pit does not download or provide full recordings. Preview recordings are for private, personal listening only and must not be copied, downloaded, redistributed, or used commercially."],
        links: [
          link("Deezer developer terms", "https://developers.deezer.com/termsofuse"),
          link("Deezer privacy policy", "https://www.deezer.com/legal/personal-datas"),
        ],
      },
      {
        heading: "Disclaimers and liability",
        paragraphs: ["Pit is provided \"as is\" and \"as available,\" without warranties of any kind. Ratings and recommendations are community-driven and offered without guarantees. To the fullest extent permitted by law, Pit isn't liable for indirect, incidental, or consequential damages, and our total liability is limited to the amount you paid us (which for a free account is zero)."],
      },
      {
        heading: "Termination",
        paragraphs: ["You can stop using Pit and delete your account at any time. We may suspend or end your access if you break these terms or if we discontinue the service. Sections meant to survive termination (licences already granted, disclaimers, and limits of liability) continue to apply."],
        links: [link("Account deletion instructions", "/account-deletion")],
      },
      {
        heading: "Changes and governing law",
        paragraphs: ["We may update these terms as Pit develops and will change the date above when we do; continuing to use Pit means you accept the changes. These terms are governed by the laws applicable where Pit operates, and disputes will be handled by the courts with jurisdiction there, except where local consumer law gives you other rights."],
      },
      {
        heading: "Questions",
        paragraphs: ["Questions about these terms can be sent to Pit support."],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
    ],
  },
  "/support": {
    title: "Support",
    description: "Get help with a Pit account, technical issue, safety report, privacy request, or account deletion.",
    intro: "Need a hand with Pit? Use the paths below to reach the right place. Never send your password, session cookie, or verification code to anyone, including Pit support.",
    note: `Email: ${SUPPORT_EMAIL}`,
    primaryAction: link("Email Pit support", `mailto:${SUPPORT_EMAIL}`),
    sections: [
      {
        heading: "Account and sign-in help",
        paragraphs: ["Use Forgot password on the sign-in screen if you no longer know your password. For email-verification or other account-access problems, email support from the address connected to the account when possible and include your Pit handle. Do not include your password."],
      },
      {
        heading: "Technical problems",
        paragraphs: ["Include what you were trying to do, your device and browser or app version, and the Pit support reference or request ID shown with the error. A screenshot can help, but remove private messages, email addresses, and other personal information you do not want to share."],
      },
      {
        heading: "Safety and content reports",
        paragraphs: ["When a Report action is available in Pit, use it so the moderation team receives the relevant item and context. For something you cannot report in the app, email support with a link or the public handle involved and a short description. Do not resend harmful content unless support asks for it."],
      },
      {
        heading: "Privacy and account data",
        paragraphs: ["You can download a portable account backup, control optional product analytics, and review blocked accounts from Settings. Email support for an access, correction, or privacy request that you cannot complete in the app. We may need to verify that the request belongs to you before acting on it."],
        links: [link("Read the Privacy policy", "/privacy")],
      },
      {
        heading: "Delete your account",
        paragraphs: ["Pit provides permanent account deletion inside the app. The public instructions explain each step and what happens to account data."],
        links: [link("Account deletion instructions", "/account-deletion")],
      },
      {
        heading: "Contact",
        paragraphs: ["Send support, safety, and privacy questions to:"],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
    ],
  },
  "/account-deletion": {
    title: "Delete your Pit account",
    description: "How to permanently delete a Pit account and its associated activity.",
    intro: "Pit lets you permanently delete your account from inside the app. Deletion starts only after you confirm the warning and your current password is verified by the server. There is no recovery period after deletion succeeds.",
    note: "You do not need to contact support if you can sign in and complete these steps.",
    sections: [
      {
        heading: "Delete your account in Pit",
        ordered: [
          "Sign in to the Pit account you want to delete.",
          "Open your account menu, choose Settings, and scroll to Danger zone.",
          "Choose Delete account and review the deletion warning.",
          "Choose Continue, enter your current password, then choose Delete account permanently.",
          "Wait for Pit to confirm deletion. If the app says it could not confirm whether deletion finished, do not submit another deletion immediately; reconnect and check whether you can sign in, then contact support with the diagnostic request ID if needed.",
        ],
      },
      {
        heading: "What deletion removes",
        paragraphs: ["Your profile, concert reviews, comments, messages, follows, ratings, fan-club activity, listening history, active product-analytics events, and other account-owned records are removed from the active service. Other people will no longer be able to find or contact the deleted account."],
      },
      {
        heading: "Storage and backup copies",
        paragraphs: ["Account deletion removes your active database records and durably queues Pit-owned uploaded photos and clips for deletion from active object storage. Cleanup retries automatically but may not finish immediately. Separate database or storage backups can remain until their retention period ends, or longer where required for legal reasons or where content was already shared with others, as described in the Terms and Privacy policy."],
        links: [
          link("Privacy policy", "/privacy"),
          link("Terms and conditions", "/terms"),
        ],
      },
      {
        heading: "Before you delete",
        paragraphs: ["If you want a copy of your information, use Download my data in Settings before deleting the account. Account deletion cannot be undone."],
      },
      {
        heading: "If you cannot sign in",
        paragraphs: ["Use Forgot password on the sign-in screen first. If you still cannot access the account, email support from the address connected to the account when possible and include your Pit handle. Support may need to verify that the request belongs to you before helping with access or deletion. Never send your password."],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
    ],
  },
});

function normalizedPath(pathname) {
  const withoutQuery = String(pathname || "/").split(/[?#]/, 1)[0];
  const withoutTrailingSlash = withoutQuery.replace(/\/+$/, "") || "/";
  return withoutTrailingSlash.toLowerCase();
}

export function publicPageFor(pathname) {
  const path = normalizedPath(pathname);
  const page = PAGES[path];
  return page ? { path, ...page } : null;
}

export function publicPageSitemapEntries() {
  return PUBLIC_PAGE_PATHS.map((path) => ({ path, priority: path === "/support" ? "0.5" : "0.3", changefreq: "monthly" }));
}

function renderLinks(links = []) {
  if (!links.length) return "";
  return `<p class="links">${links.map(({ label, href }) => {
    const external = /^https:\/\//.test(href);
    return `<a href="${esc(href)}"${external ? ' rel="noopener noreferrer"' : ""}>${esc(label)}</a>`;
  }).join("<span aria-hidden=\"true\"> / </span>")}</p>`;
}

function renderSection(section) {
  const paragraphs = (section.paragraphs || []).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("\n        ");
  const ordered = section.ordered?.length
    ? `<ol>${section.ordered.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`
    : "";
  return `<section>
      <h2>${esc(section.heading)}</h2>
      ${paragraphs}
      ${ordered}
      ${renderLinks(section.links)}
    </section>`;
}

function publicOrigin(env = process.env) {
  return String(env.PUBLIC_ORIGIN || "https://www.mshpit.com").replace(/\/+$/, "");
}

export function renderPublicPage(pathname, env = process.env) {
  const page = publicPageFor(pathname);
  if (!page) return null;
  const canonical = `${publicOrigin(env)}${page.path}`;
  const fullTitle = `${page.title} | ${SITE_NAME}`;
  const primaryAction = page.primaryAction
    ? `<a class="primary" href="${esc(page.primaryAction.href)}">${esc(page.primaryAction.label)}</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0d0b09" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(page.description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(fullTitle)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <style>
    :root { color-scheme: dark; --bg:#0d0b09; --panel:#171310; --text:#fff9ec; --dim:#c9c0b2; --muted:#92887c; --line:#332b24; --gold:#f3b61f; --gold-ink:#171006; }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body { margin: 0; background: radial-gradient(circle at 12% -10%, #2b2115 0, var(--bg) 34rem); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
    a { color: #ffd45c; text-underline-offset: .2em; }
    a:hover { color: #ffe69d; }
    a:focus-visible { outline: 3px solid var(--gold); outline-offset: 4px; border-radius: 3px; }
    .skip { position: absolute; left: 1rem; top: -5rem; z-index: 10; background: var(--gold); color: var(--gold-ink); padding: .6rem .9rem; font-weight: 800; }
    .skip:focus { top: 1rem; }
    header { border-bottom: 1px solid var(--line); background: rgba(13,11,9,.88); backdrop-filter: blur(12px); }
    .bar { max-width: 880px; margin: 0 auto; min-height: 72px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .brand { color: var(--gold); text-decoration: none; font-family: Georgia, serif; font-size: 1.35rem; font-weight: 900; letter-spacing: .28em; }
    nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px 18px; font-size: .875rem; }
    nav a { color: var(--dim); text-decoration: none; }
    nav a[aria-current="page"] { color: var(--gold); }
    main { max-width: 760px; margin: 0 auto; padding: 64px 24px 88px; }
    .eyebrow { margin: 0 0 10px; color: var(--gold); font-size: .72rem; font-weight: 900; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 700px; font-family: Georgia, serif; font-size: clamp(2.2rem, 8vw, 4.25rem); line-height: 1.04; letter-spacing: -.04em; }
    .updated { margin: 16px 0 0; color: var(--muted); font-size: .875rem; }
    .intro { margin: 28px 0 0; color: var(--dim); font-size: 1.125rem; line-height: 1.75; }
    .note { margin: 28px 0 44px; padding: 18px 20px; border: 1px solid #5b481d; border-left: 4px solid var(--gold); border-radius: 12px; background: #1c1710; color: var(--dim); }
    .primary { display: inline-flex; margin: -20px 0 44px; padding: 12px 18px; border-radius: 999px; background: var(--gold); color: var(--gold-ink); font-weight: 900; text-decoration: none; }
    .primary:hover { color: var(--gold-ink); background: #ffcc45; }
    section { padding: 30px 0; border-top: 1px solid var(--line); }
    h2 { margin: 0 0 12px; color: var(--text); font-size: 1.2rem; line-height: 1.35; }
    p { margin: 0 0 14px; color: var(--dim); }
    p:last-child { margin-bottom: 0; }
    ol { margin: 14px 0 0; padding-left: 1.4rem; color: var(--dim); }
    li { margin: 0 0 12px; padding-left: .4rem; }
    .links { display: flex; flex-wrap: wrap; gap: 2px 8px; margin-top: 14px; font-weight: 700; }
    footer { border-top: 1px solid var(--line); color: var(--muted); }
    .foot { max-width: 880px; margin: 0 auto; padding: 28px 24px 40px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px 24px; font-size: .85rem; }
    .foot p { margin: 0; color: var(--muted); }
    .foot-links { display: flex; flex-wrap: wrap; gap: 14px; }
    @media (max-width: 620px) { .bar { align-items: flex-start; flex-direction: column; padding-top: 19px; padding-bottom: 19px; } nav { justify-content: flex-start; } main { padding-top: 46px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header>
    <div class="bar">
      <a class="brand" href="/" aria-label="Pit home">PIT</a>
      <nav aria-label="Public information">
        ${PUBLIC_PAGE_PATHS.map((path) => `<a href="${path}"${path === page.path ? ' aria-current="page"' : ""}>${path === "/account-deletion" ? "Delete account" : esc(PAGES[path].title)}</a>`).join("\n        ")}
      </nav>
    </div>
  </header>
  <main id="content">
    <p class="eyebrow">Public information</p>
    <h1>${esc(page.title)}</h1>
    ${page.updated ? `<p class="updated">Last updated ${esc(page.updated)}</p>` : ""}
    <p class="intro">${esc(page.intro)}</p>
    ${page.note ? `<p class="note">${esc(page.note)}</p>` : ""}
    ${primaryAction}
    ${page.sections.map(renderSection).join("\n    ")}
  </main>
  <footer>
    <div class="foot">
      <p>Pit - Your life's musical journey</p>
      <div class="foot-links">
        <a href="/">Open Pit</a>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </div>
    </div>
  </footer>
</body>
</html>\n`;
}
