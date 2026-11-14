// Shared status meanings; safe to load without achievement presentation data.
export const STATUS_BADGES = Object.freeze({
  "first-wave": { label: "First Wave", desc: "One of Pit's first 1,000 eligible email-confirmed member accounts. An early-member milestone, not an identity check.", how: "Awarded automatically after email confirmation and account setup. Places are never recycled." },
  "email-confirmed": { label: "Email confirmed", desc: "This account confirmed its email inbox. This does not verify the person's identity or an artist claim.", how: "Confirm your email and complete account setup." },
  verified: { label: "Verified", desc: "Identity confirmed by the Pit team.", how: "Granted by an admin to real, notable accounts." },
  sponsor: { label: "Sponsor", desc: "An official Pit partner or sponsor.", how: "Granted by the Pit team to partners." },
  top100: { label: "Top 100", desc: "One of the 100 most popular artists on Pit.", how: "Rank in the global Top 100 by popularity." },
  staff: { label: "Pit Team", desc: "Works on Pit.", how: "Reserved for staff." },
  mod: { label: "Moderator", desc: "Keeps the community healthy.", how: "Appointed by an admin." },
  founder: { label: "Founder", desc: "Built Pit.", how: "Reserved." },
  artist: { label: "Verified Artist", desc: "An official, claimed artist account.", how: "Claim your artist page; an admin approves." },
});
