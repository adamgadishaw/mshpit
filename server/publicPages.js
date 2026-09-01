// Crawler-readable public documents used by App Store Connect and by people
// who cannot (or do not want to) sign in. These pages intentionally do not run
// the Expo bundle: legal/support information must remain readable without
// JavaScript, an account, local storage, or a working API.
import {
  ANNOUNCEMENT_EMAIL_DISCLOSURE,
  CRASH_MONITORING_DISCLOSURE,
  MEDIA_AND_SESSION_SECURITY_DISCLOSURE,
  PRIVACY_POLICY_UPDATED,
  PROFILE_SEARCH_INDEXING_DISCLOSURE,
} from "../src/domain/privacyDisclosures.mjs";
import { SUPPORT_EMAIL } from "../src/domain/contact.mjs";

import { htmlRobotsDirective } from "./environment.js";
const SITE_NAME = "Mshpit";
export { SUPPORT_EMAIL };

export const PUBLIC_PAGE_PATHS = Object.freeze([
  "/about",
  "/contact",
  "/community-guidelines",
  "/ratings-methodology",
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
  "/about": {
    title: "About Mshpit",
    description: "Mshpit is a live-music social network for remembering shows, sharing honest fan experiences, and discovering music through people.",
    intro: "Mshpit is built around the part of music that streaming cannot capture: being there. It gives concert fans one place to log their show history, preserve the feeling of a night, and discover artists, venues, and future shows through other people.",
    note: "Mshpit is an independent fan community. Artist, venue, and ticket-provider names identify the subject of a page and do not imply endorsement.",
    sections: [
      {
        heading: "A live-music history built with other fans",
        paragraphs: ["Members can record the date, artist, venue, rating, review, and media from a concert. Those memories build a personal live-music history while contributing to artist and concert communities that help other fans understand what a show actually felt like."],
      },
      {
        heading: "Discovery through real live-music taste",
        paragraphs: ["Mshpit connects artist pages, upcoming event information, venue pages, and fan reviews. The goal is to make discovery feel human: not only what is popular, but what moved people whose taste you trust."],
        links: [link("Browse artists", "/artists"), link("Browse upcoming concerts", "/events")],
      },
      {
        heading: "Fan voices and artist voices",
        paragraphs: ["Fan reviews remain attributed to the members who wrote them. Verified artist accounts can manage artist-facing information and share official updates. A verified badge identifies an account status; it does not turn fan opinion into an artist endorsement."],
      },
      {
        heading: "How public information is handled",
        paragraphs: ["Public pages expose only information intended for public discovery. Members can keep their personal profile out of search-engine results without making independently public posts private. Photos used in aggregate artist, venue, or concert galleries require the applicable sharing choice."],
        links: [link("Read the Privacy policy", "/privacy"), link("Read the ratings methodology", "/ratings-methodology")],
      },
    ],
  },
  "/contact": {
    title: "Contact Mshpit",
    description: "Contact Mshpit about account help, safety, privacy, artist pages, partnerships, or technical problems.",
    intro: "Use the monitored support address below for Mshpit questions. Include only the information needed to understand the issue, and never send a password, session cookie, or verification code.",
    note: `Public support email: ${SUPPORT_EMAIL}`,
    primaryAction: link("Email Mshpit", `mailto:${SUPPORT_EMAIL}`),
    sections: [
      {
        heading: "Account, product, and technical help",
        paragraphs: ["For sign-in trouble, a broken feature, or a question about your account, describe what happened, the device or browser involved, and any support reference shown by Mshpit. Screenshots are useful after private information is removed."],
        links: [link("Open Support", "/support")],
      },
      {
        heading: "Safety, moderation, and privacy",
        paragraphs: ["Use an in-product Report action when one is available. For an issue that cannot be reported there, email the public URL or handle and a short explanation. Privacy and account-data requests may require account ownership verification."],
        links: [link("Community guidelines", "/community-guidelines"), link("Privacy policy", "/privacy")],
      },
      {
        heading: "Artists, venues, and factual corrections",
        paragraphs: ["Artists, representatives, venues, and fans can report an incorrect public fact or ask about an artist profile through support. Include the exact Mshpit page and a reliable source for the requested correction. Verification or memorial changes are reviewed before publication."],
      },
      {
        heading: "Business and media enquiries",
        paragraphs: ["Partnership, press, and other business enquiries can begin at the same monitored address and will be routed to the appropriate owner."],
        links: [link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)],
      },
    ],
  },
  "/community-guidelines": {
    title: "Community guidelines",
    description: "The standards for honest reviews, respectful discussion, safe media, artist pages, and participation on Mshpit.",
    updated: "August 2026",
    intro: "Mshpit works when people can be excited, opinionated, and honest about music without making the community unsafe. These guidelines explain the behavior and content expected across reviews, comments, messages, media, and profiles.",
    note: "Context matters. Mshpit can remove content, limit features, or restrict accounts when needed to protect people, the integrity of ratings, or the service.",
    sections: [
      {
        heading: "Review shows honestly",
        paragraphs: ["Log concerts you attended and describe your own experience. Do not fabricate attendance, coordinate rating manipulation, trade engagement, impersonate another fan, or use reviews to settle unrelated disputes. Disagreement about a performance is welcome; deceptive activity is not."],
      },
      {
        heading: "Respect people in the crowd",
        paragraphs: ["Do not post harassment, threats, hate, sexual exploitation, targeted humiliation, or another person's private information. Do not encourage unwanted contact. Critique music and public performances without turning that critique into abuse of artists, staff, or other fans."],
      },
      {
        heading: "Share media you are allowed to share",
        paragraphs: ["Only upload photos or clips you have the right to post. Respect venue rules, personal privacy, and requests involving sensitive images. Do not upload full copyrighted performances, pirated recordings, malware, or content intended to evade rights controls."],
      },
      {
        heading: "Keep artist and event information accurate",
        paragraphs: ["Artist, venue, tour, setlist, memorial, and event details should be entered in good faith. Do not knowingly publish false death notices, fake events, misleading ticket destinations, or an affiliation you do not have. Corrections may merge or relabel community records without changing the substance of a member's review."],
      },
      {
        heading: "No spam or artificial reach",
        paragraphs: ["Do not automate engagement, scrape private surfaces, repeatedly advertise unrelated services, conceal commercial links, or flood comments and messages. Artist promotion should remain relevant, accurately attributed, and within the features provided for it."],
      },
      {
        heading: "Reporting and review",
        paragraphs: ["Use Report where available or contact support with the relevant public page. Mshpit reviews the available context and may preserve limited records needed for safety, appeals, or legal obligations. Enforcement decisions can be appealed through the monitored support channel."],
        links: [link("Contact Mshpit", "/contact"), link("Terms and conditions", "/terms")],
      },
    ],
  },
  "/ratings-methodology": {
    title: "How Mshpit ratings work",
    description: "How Mshpit collects, calculates, displays, and protects fan ratings and concert-review summaries.",
    updated: "August 2026",
    intro: "Mshpit ratings summarize the opinions of members who log live shows. They are community signals, not professional criticism, ticket guarantees, artist endorsements, or scientific measurements.",
    note: "A displayed average is calculated from the eligible ratings attached to that exact public subject and can change as reviews are added, edited, removed, or moderated.",
    sections: [
      {
        heading: "The rating scale",
        paragraphs: ["Members rate in-person live experiences on a five-point scale. A higher number means the member reported a stronger experience. Written reviews, tags, photos, the artist, venue, and concert date provide context that a number alone cannot capture. Reviews of concerts watched online are clearly labelled and their ratings do not change the artist's live-show score."],
      },
      {
        heading: "What an average represents",
        paragraphs: ["Mshpit uses the arithmetic mean of eligible member ratings for the same entity or concert night and shows a count alongside it. Ratings are not silently weighted by follower count, account role, advertising, ticket value, or artist status. Different pages can represent different scopes, so an exact concert-night score is not the same as an artist's broader live history."],
      },
      {
        heading: "Eligibility and moderation",
        paragraphs: ["Removed posts, banned or deleted accounts, and content excluded by safety controls do not contribute to public summaries. Mshpit may investigate coordinated manipulation, duplicate or fabricated reviews, and other behavior that compromises rating integrity."],
      },
      {
        heading: "Small samples and change over time",
        paragraphs: ["A rating based on a small number of reviews can move substantially when another person contributes. Mshpit displays the rating count so readers can judge that context. Historical concert archives remain tied to the show date, while edits and moderation can update the visible result."],
      },
      {
        heading: "Corrections and questions",
        paragraphs: ["If reviews appear attached to the wrong artist, venue, or date, send the exact public page to support. Mshpit can correct entity matching without rewriting a member's stated opinion."],
        links: [link("Contact Mshpit", "/contact"), link("Community guidelines", "/community-guidelines")],
      },
    ],
  },
  "/privacy": {
    title: "Privacy policy",
    description: "How Mshpit collects, uses, shares, retains, and lets you control your information.",
    updated: PRIVACY_POLICY_UPDATED,
    intro: "Mshpit, branded as PIT in the app and referred to below as Pit, is a social service for logging concerts, rating them, and following people whose taste matches yours. We use account and activity data to operate the service, protect it from abuse, and personalize music and local-show features. This policy describes what we collect, why, and the choices you have.",
    note: "You can download or delete your account data and turn optional product analytics off from Settings.",
    sections: [
      {
        heading: "Information you give us",
        paragraphs: [
          "Account details (name, email, password, and the city you choose), your profile (bio, avatar, genres, and favorite artists), feed preferences such as Not for me, and everything you create on Pit: reviews, ratings, photos, comments, fan-club and lounge messages, direct messages, follows, and other content or settings you save. The suggestion box accepts an anonymous category, message, and optional general area of Pit; Pit does not attach the suggestion to an account or ask for contact details.",
        ],
      },
      {
        heading: "Information we collect automatically",
        paragraphs: [
          "For signed-in accounts that have product analytics enabled, Pit records a limited, server-approved set of categorical events such as screen and feed usage, internal post impressions, opening content, time-range buckets, following, liking, and posting.",
          "Separately, when a guest searches, Pit increments daily aggregate counters for the search category, success or failure, and a coarse result-count range. These counters do not contain typed words, account or device identifiers, cookies, URLs, IP addresses, user agents, or exact request times, and cannot identify a unique visitor.",
          "Like every web service, Pit receives an IP address and basic request details when a device connects. Those details may be processed briefly for security and rate limiting, but raw IP addresses are not retained in product analytics or suggestion records.",
        ],
      },
      {
        heading: CRASH_MONITORING_DISCLOSURE.heading,
        paragraphs: [...CRASH_MONITORING_DISCLOSURE.paragraphs],
      },
      {
        heading: "Cookies and similar technologies",
        paragraphs: [
          "Pit uses first-party session cookies and local storage to keep you signed in, restore navigation, remember preferences, and make the app work. Links to third-party services are governed by those services' own privacy and cookie policies when you open them. Most browsers let you clear or block stored data, though sign-in and other features may stop working.",
        ],
      },
      {
        heading: "How we use your data",
        paragraphs: [
          "We use information to provide and secure the service; deliver your feed, messages, local discovery, recommendations, search, and account support; understand aggregate feature health; develop new features; detect abuse and enforce our Terms; and communicate with you when needed.",
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
          "We share information with service providers that host, secure, deliver email for, and operate Pit on our behalf; with YouTube when a signed-in member asks Pit to validate a YouTube link for a post; with Deezer when Pit resolves public music-catalogue metadata; with other users according to the feature you use (for example, a public review is public while a direct message is shown to its participants); and when required by law or reasonably necessary to protect people and the service. A business transfer may include data subject to appropriate safeguards.",
        ],
      },
      {
        heading: "YouTube links shared in posts",
        paragraphs: [
          "A signed-in member can attach a YouTube URL to a post. Pit sends the canonical URL to YouTube's oEmbed service to validate it and retrieve public display metadata such as the title, channel name, and thumbnail, then stores the chosen link and metadata with the post. Pit does not receive your YouTube password or download YouTube videos. If you open a YouTube link, YouTube receives that visit under Google's privacy practices.",
        ],
        links: [
          link("Google Privacy Policy", "https://policies.google.com/privacy"),
          link("YouTube Terms of Service", "https://www.youtube.com/t/terms"),
        ],
      },
      {
        heading: "Music catalogue metadata",
        paragraphs: [
          "Pit uses Deezer catalogue information to help identify artists and tracks and to display available public metadata such as titles, artwork, genres, rankings, and top tracks. Pit's server may send an artist or track search term to Deezer to resolve that metadata. Pit does not receive a Deezer password or download or provide Deezer recordings.",
        ],
        links: [link("Deezer privacy policy", "https://www.deezer.com/legal/personal-datas")],
      },
      {
        heading: "Your choices and rights",
        paragraphs: [
          "You can edit your profile, download a portable account backup, delete content, block accounts, turn product analytics off, or permanently delete your account from Settings. Turning analytics off deletes that account's existing product-event rows and prevents new ones from being recorded.",
          PROFILE_SEARCH_INDEXING_DISCLOSURE,
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
          `Account and content data is kept while needed to operate the account and service. Raw first-party product analytics is automatically limited to a rolling 30-day period by default and is deleted earlier when you opt out or delete your account. Aggregate guest-search counters are retained for up to 90 days. Closed suggestion records are pruned after 90 days and unresolved suggestions after one year. If an artist search returns no match, the submitted artist name may remain in a bounded staff enrichment queue for up to 30 days. ${MEDIA_AND_SESSION_SECURITY_DISCLOSURE} Passwords are hashed, signed-in requests use HTTPS in production, and access is limited, but no online service can promise perfect security.`,
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
    description: "The rules and conditions that apply when you create an account or use Mshpit.",
    updated: "August 2026",
    intro: "Welcome to Mshpit, branded as PIT in the app and referred to below as Pit. By creating an account or using Pit you agree to these Terms and Conditions and to our Privacy policy, which explains how we collect and use your data. Please read both carefully.",
    note: "These terms form a binding agreement between you and Mshpit. If you don't agree with them, don't use Pit.",
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
        paragraphs: ["Only mark a physical show as attended when you were actually there. If you review a concert watched online, use the online-review option and link the YouTube video you watched. Don't post spam, hate speech, harassment, threats, illegal content, or anyone's private information; don't impersonate others, manipulate ratings, scrape the service, interfere with its operation, or attempt to access it in unauthorized ways. You agree to follow all applicable laws while using Pit."],
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
        heading: "YouTube links in posts",
        paragraphs: ["Members may attach a YouTube link to a post. Pit may use YouTube's oEmbed service to validate that link and retrieve public display metadata, but Pit does not download, host, or provide the underlying YouTube video. You are responsible for the links you share, and YouTube's Terms of Service apply when you use YouTube."],
        links: [link("YouTube Terms of Service", "https://www.youtube.com/t/terms")],
      },
      {
        heading: "Music catalogue metadata",
        paragraphs: ["Pit uses Deezer catalogue information for artist and track identification and related public metadata. That information remains controlled by Deezer and its right holders. Pit does not download or provide Deezer recordings, and catalogue references do not grant anyone rights to copy or redistribute third-party material."],
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
    description: "Get help with a Mshpit account, technical issue, safety report, privacy request, or account deletion.",
    intro: "Need a hand with Mshpit? Use the paths below to reach the right place. Never send your password, session cookie, or verification code to anyone, including Mshpit support.",
    note: `Email: ${SUPPORT_EMAIL}`,
    primaryAction: link("Email Mshpit support", `mailto:${SUPPORT_EMAIL}`),
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
    title: "Delete your Mshpit account",
    description: "How to permanently delete a Mshpit account and its associated activity.",
    intro: "Mshpit lets you permanently delete your account from inside the app. Deletion starts only after you confirm the warning and your current password is verified by the server. There is no recovery period after deletion succeeds.",
    note: "You do not need to contact support if you can sign in and complete these steps.",
    sections: [
      {
        heading: "Delete your account in Mshpit",
        ordered: [
          "Sign in to the Mshpit account you want to delete.",
          "Open your account menu, choose Settings, and scroll to Danger zone.",
          "Choose Delete account and review the deletion warning.",
          "Choose Continue, enter your current password, then choose Delete account permanently.",
          "Wait for Mshpit to confirm deletion. If the app says it could not confirm whether deletion finished, do not submit another deletion immediately; reconnect and check whether you can sign in, then contact support with the diagnostic request ID if needed.",
        ],
      },
      {
        heading: "What deletion removes",
        paragraphs: ["Your profile, concert reviews, comments, messages, follows, ratings, fan-club activity, active product-analytics events, and other account-owned content and activity records are removed from the active service. Other people will no longer be able to find or contact the deleted account."],
      },
      {
        heading: "Storage and backup copies",
        paragraphs: ["Account deletion removes your active database records and durably queues Mshpit-owned uploaded photos and clips for deletion from active object storage. Cleanup retries automatically but may not finish immediately. Separate database or storage backups can remain until their retention period ends, or longer where required for legal reasons or where content was already shared with others, as described in the Terms and Privacy policy."],
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
        paragraphs: ["Use Forgot password on the sign-in screen first. If you still cannot access the account, email support from the address connected to the account when possible and include your Mshpit handle. Support may need to verify that the request belongs to you before helping with access or deletion. Never send your password."],
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
  try {
    const parsed = new URL(String(env.PUBLIC_ORIGIN || "https://www.mshpit.com"));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new TypeError("Invalid public origin");
    return parsed.origin;
  } catch {
    return "https://www.mshpit.com";
  }
}

const structuredJson = (value) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const DISPLAY_MONTHS = Object.freeze({
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
});

function exactDateModified(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const displayDate = /^(January|February|March|April|May|June|July|August|September|October|November|December) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(text);
  const parts = isoDate
    ? { year: Number(isoDate[1]), month: Number(isoDate[2]), day: Number(isoDate[3]) }
    : displayDate
      ? { year: Number(displayDate[3]), month: DISPLAY_MONTHS[displayDate[1]], day: Number(displayDate[2]) }
      : null;

  if (parts) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) return null;
    return date.toISOString().slice(0, 10);
  }

  // A timestamp is machine-authoritative only when it includes both a time and
  // an explicit timezone. Month-only policy labels intentionally do not qualify.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const timestamp = new Date(text);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

export function renderPublicPage(pathname, env = process.env) {
  const page = publicPageFor(pathname);
  if (!page) return null;
  const canonical = `${publicOrigin(env)}${page.path}`;
  const fullTitle = /\bmshpit\b/i.test(page.title) ? page.title : `${page.title} | ${SITE_NAME}`;
  const image = `${publicOrigin(env)}/og.png`;
  const pageType = page.path === "/about" ? "AboutPage" : page.path === "/contact" ? "ContactPage" : "WebPage";
  const dateModified = exactDateModified(page.modifiedAt || page.updated);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${publicOrigin(env)}/#organization`,
        name: SITE_NAME,
        alternateName: "PIT",
        url: `${publicOrigin(env)}/`,
        logo: { "@type": "ImageObject", url: `${publicOrigin(env)}/logo.svg`, width: 512, height: 512 },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: SUPPORT_EMAIL,
          url: `${publicOrigin(env)}/contact`,
          availableLanguage: "English",
        },
      },
      {
        "@type": pageType,
        "@id": `${canonical}#page`,
        name: page.title,
        headline: page.title,
        description: page.description,
        url: canonical,
        isPartOf: { "@type": "WebSite", "@id": `${publicOrigin(env)}/#website`, name: SITE_NAME, url: `${publicOrigin(env)}/` },
        publisher: { "@id": `${publicOrigin(env)}/#organization` },
        ...(dateModified ? { dateModified } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${publicOrigin(env)}/` },
          { "@type": "ListItem", position: 2, name: page.title, item: canonical },
        ],
      },
    ],
  };
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
  <meta name="robots" content="${esc(htmlRobotsDirective({ indexable: true, env }))}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" href="/logo.svg" type="image/svg+xml" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:locale" content="en_CA" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(fullTitle)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(fullTitle)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(fullTitle)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="twitter:image:alt" content="${esc(fullTitle)}" />
  <script type="application/ld+json">${structuredJson(jsonLd)}</script>
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
    .crumbs { margin: 0 0 28px; color: var(--muted); font-size: .8rem; }
    .crumbs a { color: var(--dim); }
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
      <a class="brand" href="/" aria-label="Mshpit home">Mshpit</a>
      <nav aria-label="Public information">
        ${PUBLIC_PAGE_PATHS.map((path) => `<a href="${path}"${path === page.path ? ' aria-current="page"' : ""}>${path === "/account-deletion" ? "Delete account" : esc(PAGES[path].title)}</a>`).join("\n        ")}
      </nav>
    </div>
  </header>
  <main id="content">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Mshpit</a><span aria-hidden="true"> / </span><span aria-current="page">${esc(page.title)}</span></nav>
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
      <p>Mshpit - Your life's musical journey</p>
      <div class="foot-links">
        <a href="/artists">Artists</a>
        <a href="/events">Events</a>
        <a href="/">Open Mshpit</a>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </div>
    </div>
  </footer>
</body>
</html>\n`;
}
