// Crew (finding people to go to a show with) is on the back burner until
// Mshpit has enough members in each city for it to work, and until it is
// reworked to feel like Mshpit rather than a swipe-on-people app. The code
// stays in the tree; this one switch keeps every route, page, link and
// search listing off. The client, server and sitemap builder all read it, so
// they cannot disagree about whether Crew exists.
export const CREW_ENABLED = false;
