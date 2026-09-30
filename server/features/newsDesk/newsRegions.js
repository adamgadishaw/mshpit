// Regional news. A member's news follows where they live: someone in Toronto
// is not shown a story that only matters in the UK. No model is involved; each
// story's regions come from its own words.
//
// A story is regional only when it is about something happening in a place:
// "announces UK tour", "tops the Official Charts", "shows in Glasgow",
// "Glastonbury", "Juno Awards". Where an artist is from never counts ("British
// singer ..."), so worldwide news stays worldwide. A story that names two or
// more regions, or a world tour, is shown everywhere.

export const NEWS_REGIONS = Object.freeze([
  { id: "us-canada", label: "US and Canada", countries: ["united states", "usa", "us", "u.s.", "u.s.a.", "america", "canada"] },
  { id: "uk-ireland", label: "UK and Ireland", countries: ["united kingdom", "uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "ireland"] },
  { id: "europe", label: "Europe", countries: ["austria", "belgium", "bulgaria", "croatia", "czechia", "czech republic", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "iceland", "italy", "latvia", "lithuania", "luxembourg", "netherlands", "norway", "poland", "portugal", "romania", "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland"] },
  { id: "latin-america", label: "Latin America", countries: ["mexico", "brazil", "argentina", "chile", "colombia", "peru", "puerto rico", "uruguay", "ecuador", "venezuela", "costa rica", "guatemala", "dominican republic"] },
  { id: "australia-nz", label: "Australia and New Zealand", countries: ["australia", "new zealand"] },
  { id: "asia", label: "Asia", countries: ["japan", "south korea", "korea", "singapore", "china", "hong kong", "taiwan", "philippines", "indonesia", "thailand", "malaysia", "vietnam", "india"] },
  { id: "africa-middle-east", label: "Africa and the Middle East", countries: ["south africa", "nigeria", "kenya", "ghana", "egypt", "morocco", "united arab emirates", "uae", "saudi arabia", "qatar", "israel", "turkey"] },
].map((region) => Object.freeze({ ...region, countries: Object.freeze(region.countries) })));

export const NEWS_REGION_CHOICES = Object.freeze(["auto", "everywhere", ...NEWS_REGIONS.map((region) => region.id)]);
export const newsRegionById = (id) => NEWS_REGIONS.find((region) => region.id === id) || null;

const fold = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// Place words, used only next to a word that makes the story about that place.
const PLACES = {
  "us-canada": {
    countries: ["united_states", "america", "canada", "north america"],
    adjectives: ["american", "canadian", "north american", "stateside"],
    cities: ["new york", "new york city", "brooklyn", "los angeles", "chicago", "nashville", "atlanta", "austin", "miami", "las vegas", "san francisco", "seattle", "boston", "philadelphia", "detroit", "houston", "dallas", "denver", "new orleans", "washington, d.c.", "toronto", "montreal", "vancouver", "calgary", "ottawa", "edmonton", "winnipeg", "quebec city", "halifax"],
    named: ["coachella", "bonnaroo", "governors ball", "outside lands", "austin city limits", "osheaga", "bet awards", "cma awards", "acm awards", "american music awards", "billboard music awards", "iheartradio music awards", "juno awards", "junos", "polaris prize", "billboard hot 100", "hot 100", "billboard 200", "madison square garden", "hollywood bowl", "red rocks", "scotiabank arena", "rogers centre", "budweiser stage"],
  },
  "uk-ireland": {
    countries: ["united_kingdom", "britain", "great britain", "england", "scotland", "wales", "northern ireland", "ireland"],
    adjectives: ["british", "scottish", "welsh", "irish"],
    cities: ["london", "manchester", "birmingham", "glasgow", "edinburgh", "cardiff", "belfast", "dublin", "liverpool", "leeds", "bristol", "newcastle", "sheffield", "nottingham", "brighton", "cork", "aberdeen"],
    named: ["glastonbury", "reading and leeds", "reading & leeds", "download festival", "isle of wight festival", "bst hyde park", "hyde park", "brit awards", "the brits", "mercury prize", "official charts", "official chart", "official singles chart", "official albums chart", "bbc radio 1", "radio 1", "wembley", "royal albert hall", "electric picnic", "creamfields", "trnsmt", "latitude festival", "parklife"],
  },
  europe: {
    countries: ["europe", "france", "germany", "spain", "italy", "netherlands", "sweden", "norway", "denmark", "finland", "poland", "portugal", "belgium", "austria", "switzerland", "greece", "hungary", "czechia", "czech republic"],
    adjectives: ["european"],
    cities: ["paris", "berlin", "amsterdam", "barcelona", "madrid", "lisbon", "rome", "milan", "stockholm", "copenhagen", "oslo", "helsinki", "vienna", "prague", "warsaw", "budapest", "brussels", "zurich", "munich", "hamburg", "cologne"],
    named: ["eurovision", "primavera sound", "tomorrowland", "roskilde", "rock werchter", "sziget", "mad cool", "rock am ring", "hellfest", "wacken", "pinkpop", "rock en seine", "open'er"],
  },
  "latin-america": {
    countries: ["latin america", "south america", "mexico", "brazil", "argentina", "chile", "colombia", "peru", "puerto rico"],
    adjectives: ["latin american", "south american"],
    cities: ["mexico city", "sao paulo", "rio de janeiro", "buenos aires", "santiago", "bogota", "lima", "guadalajara", "monterrey", "san juan", "medellin"],
    named: ["vive latino", "rock in rio", "estereo picnic", "lollapalooza argentina", "lollapalooza brasil", "lollapalooza chile", "corona capital"],
  },
  "australia-nz": {
    countries: ["australia", "new zealand", "aotearoa"],
    adjectives: ["australian", "kiwi"],
    cities: ["sydney", "melbourne", "brisbane", "perth", "adelaide", "auckland", "wellington"],
    named: ["aria awards", "aria chart", "aria charts", "splendour in the grass", "triple j", "hottest 100", "sydney opera house"],
  },
  asia: {
    countries: ["asia", "japan", "south korea", "korea", "china", "singapore", "philippines", "indonesia", "thailand", "india", "taiwan", "hong kong"],
    adjectives: ["asian"],
    cities: ["tokyo", "osaka", "seoul", "singapore", "hong kong", "taipei", "manila", "jakarta", "bangkok", "mumbai", "delhi"],
    named: ["summer sonic", "fuji rock", "mama awards"],
  },
  "africa-middle-east": {
    countries: ["africa", "middle east", "nigeria", "south africa", "kenya", "ghana", "egypt", "morocco", "saudi arabia", "united arab emirates", "israel", "qatar"],
    adjectives: ["african"],
    cities: ["lagos", "johannesburg", "cape town", "nairobi", "accra", "dubai", "abu dhabi", "riyadh", "tel aviv", "doha", "cairo"],
    named: ["headies", "afrochella"],
  },
};

const EVENT_AFTER = "(?:tour|tours|tour dates|dates|shows|show|concerts|concert|leg|run|arena tour|stadium tour|headline tour|headlining tour|festival|festivals|chart|charts|singles chart|albums chart|album chart|number one|no\\. 1|no 1|premiere|residency|gigs|gig)";
const EVENT_BEFORE = "(?:in|at|across|around|throughout|to|tour of|tour through|dates in|shows in|concerts in|gigs in|coming to|comes to|heads to|headed to|returns to|return to)";
// Where someone is from, lives or recorded is not where the news happens.
const NOT_AN_EVENT = "(?<!(?:born|raised|based|grew up|formed|lives|living|native|residing|recorded|filmed|shot|written|made|died|dies|passed away|arrested|hospitalized|hospitalised|home|studio)\\s)";
const alternation = (list) => [...new Set(list)].map((word) => escape(word)).sort((left, right) => right.length - left.length).join("|");

// Lists name several places at once: "UK and Ireland stadium dates", "shows in
// London and Toronto". Each place in the list counts for its own region.
const SEPARATOR = "(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)";
const ANY_PLACE = alternation(Object.values(PLACES).flatMap((places) => [...places.countries, ...places.cities]));
const ANY_COUNTRY = alternation(Object.values(PLACES).flatMap((places) => [...places.countries, ...places.adjectives]));
const LEADING_PLACES = `(?:(?:the\\s+)?(?:${ANY_PLACE})${SEPARATOR}){0,6}`;
// A word or two may sit between the place and the event: "UK stadium dates", "US 2027 tour".
const QUALIFIER = "(?:\\s+(?:stadium|arena|summer|autumn|fall|winter|spring|headline|headlining|farewell|reunion|anniversary|more|new|extra|additional|\\d{4})){0,2}";

const MATCHERS = Object.entries(PLACES).map(([id, places]) => {
  const countries = alternation(places.countries);
  const adjectives = alternation(places.adjectives);
  const cities = alternation(places.cities);
  return {
    id,
    patterns: [
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${countries}|${adjectives})(?:${SEPARATOR}(?:${ANY_COUNTRY}))*${QUALIFIER}\\s+${EVENT_AFTER}(?![\\p{L}\\p{N}])`, "u"),
      new RegExp(`${NOT_AN_EVENT}(?<![\\p{L}\\p{N}])${EVENT_BEFORE}\\s+${LEADING_PLACES}(?:the\\s+)?(?:${countries})(?![\\p{L}\\p{N}])`, "u"),
      new RegExp(`${NOT_AN_EVENT}(?<![\\p{L}\\p{N}])(?:in|at|to|across)\\s+${LEADING_PLACES}(?:${cities})(?![\\p{L}\\p{N}])`, "u"),
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${cities})\\s+(?:show|shows|concert|concerts|date|dates|gig|gigs|residency|stadium show|arena show)(?![\\p{L}\\p{N}])`, "u"),
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(places.named)})(?![\\p{L}\\p{N}])`, "u"),
    ],
  };
});

// A world tour, or a night the whole world watches, is for everyone even
// when the story says which city it happened in.
const WORLDWIDE = /(?<![\p{L}\p{N}])(?:world tour|worldwide|global tour|international tour|around the world|across the world|grammy|grammys|grammy awards|oscar|oscars|academy awards?|super bowl|video music awards|vmas|met gala)(?![\p{L}\p{N}])/u;
// Deaths and court cases are reported wherever they happened.
const ALWAYS_WORLDWIDE = new Set(["death", "legal"]);

// Case matters for "US" and "UK" (not "us"), so they become words first.
function storyText(story) {
  const raw = [story?.headline, story?.summary, story?.body].filter(Boolean).join(" \n ");
  return fold(raw.replace(/(?<![A-Za-z])U\.?S\.?A?\.?(?![A-Za-z])/gu, " united_states ").replace(/(?<![A-Za-z])U\.?K\.?(?![A-Za-z])/gu, " united_kingdom "));
}

// The regions a story is about: [] for worldwide news.
export function newsStoryRegions(story) {
  if (ALWAYS_WORLDWIDE.has(String(story?.category || ""))) return [];
  const text = storyText(story);
  if (!text || WORLDWIDE.test(text)) return [];
  const found = MATCHERS.filter((matcher) => matcher.patterns.some((pattern) => pattern.test(text))).map((matcher) => matcher.id);
  return found.length === 1 ? found : [];
}

// Worldwide stories go to everyone; a regional story only to its region.
// `region` null means the reader sees everything.
export function newsStoryVisibleIn(story, region) {
  if (!region) return true;
  const regions = newsStoryRegions(story);
  return !regions.length || regions.includes(region);
}

// The reader's own city named in the story ("Toronto"), for a small badge and
// a lift in top stories.
export function newsStoryMentionsCity(story, city) {
  const name = fold(city);
  if (name.length < 3) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "u").test(storyText(story));
}

// "Toronto, Ontario, Canada" -> { city: "Toronto", region: "us-canada" }.
export function newsRegionForHomeCity(homeCity) {
  const parts = String(homeCity || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { city: null, region: null };
  const country = fold(parts[parts.length - 1]);
  const region = parts.length > 1 ? NEWS_REGIONS.find((item) => item.countries.includes(country)) || null : null;
  return { city: parts[0], region: region?.id || null };
}

export function ensureNewsRegionSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_region_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    choice TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
}

export function readNewsRegionChoice(database, userId) {
  if (!userId) return "auto";
  try {
    const choice = database.prepare("SELECT choice FROM news_region_prefs WHERE user_id=?").get(String(userId))?.choice;
    return NEWS_REGION_CHOICES.includes(choice) ? choice : "auto";
  } catch (error) {
    if (/no such table/iu.test(String(error?.message))) return "auto";
    throw error;
  }
}

export function setNewsRegionChoice(database, { userId, choice, at = Date.now() }) {
  if (!NEWS_REGION_CHOICES.includes(choice)) return null;
  ensureNewsRegionSchema(database);
  if (choice === "auto") database.prepare("DELETE FROM news_region_prefs WHERE user_id=?").run(String(userId));
  else database.prepare(`INSERT INTO news_region_prefs (user_id,choice,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET choice=excluded.choice, updated_at=excluded.updated_at`).run(String(userId), choice, at);
  return choice;
}

// A member's news region: read it, or pick automatic, a region or everywhere.
export function newsRegionRoutes({ database, requireUser, rateLimit, ApiError, now = Date.now }) {
  ensureNewsRegionSchema(database);
  const view = (user) => {
    const place = viewerNewsRegion(database, user);
    return {
      choice: place.choice, region: place.region, label: place.label, city: place.city,
      home: place.home, homeLabel: newsRegionById(place.home)?.label || null,
      options: NEWS_REGIONS.map(({ id, label }) => ({ id, label })),
    };
  };
  return {
    "GET /api/me/news-region": (ctx) => {
      const user = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return { newsRegion: view(user) };
    },
    "PUT /api/me/news-region": (ctx) => {
      const user = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "news-region", 30, 10 * 60_000);
      if (!setNewsRegionChoice(database, { userId: user.id, choice: ctx.body?.choice, at: now() })) {
        throw new ApiError(400, "Choose where your news comes from.", "VALIDATION_FAILED");
      }
      return { newsRegion: view(user) };
    },
  };
}

// What a reader's news follows: their choice, the region it resolves to (null
// for everything) and their home city for local stories.
export function viewerNewsRegion(database, viewer) {
  if (!viewer?.id) return { choice: "everywhere", region: null, label: "Everywhere", city: null, home: null };
  const choice = readNewsRegionChoice(database, viewer.id);
  const home = newsRegionForHomeCity(viewer.home_city);
  const region = choice === "auto" ? home.region : choice === "everywhere" ? null : choice;
  return { choice, region, label: newsRegionById(region)?.label || "Everywhere", city: home.city, home: home.region };
}
