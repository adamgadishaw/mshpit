// Public contact points belong in one shared module so account, legal, and
// support surfaces cannot quietly drift to different or retired domains.
export const SUPPORT_EMAIL = "support@mshpit.com";
export const SUPPORT_URL = "https://www.mshpit.com/support";
export const CONTACT_URL = "https://www.mshpit.com/contact";
export const JOBS_URL = "https://www.mshpit.com/jobs";

// Appeals currently share the monitored support queue. Splitting the queue
// later is one deliberate constant change, not a hunt through UI copy.
export const APPEALS_EMAIL = SUPPORT_EMAIL;
