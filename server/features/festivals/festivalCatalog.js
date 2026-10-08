// The festivals Mshpit follows. A festival here is a brand ("Rolling Loud");
// each dated run in one place is an edition ("Rolling Loud Miami 2026").
// Only identity lives here: the name, the words that pick its events out of a
// ticket listing, where it is usually held, and its English Wikipedia title.
// Dates, lineups, images, history and the official site come from Ticketmaster,
// Wikipedia and Wikidata at refresh time (server/features/festivals/), never
// from this list, so nothing here goes stale or gets guessed.
//
// match: lowercase phrases; an event belongs to the festival when its name
// contains one. exclude: phrases that make a lookalike event not count
// (after-parties, club nights, tribute shows).

const festival = (slug, name, { match = [name.toLowerCase()], exclude = [], city = "", country = "", wikipedia = null, search = name, identityFamily = null } = {}) =>
  Object.freeze({ slug, name, match: Object.freeze(match), exclude: Object.freeze(exclude), city, country, wikipedia, search, identityFamily });

const COMMON_EXCLUDES = ["after party", "afterparty", "after-party", "aftershow", "after show", "after-show", "pre-party", "pre party", "tribute",
  "viewing party", "shuttle", "parking", "camping only", "hotel"];

export const FESTIVAL_CATALOG = Object.freeze([
  festival("coachella", "Coachella", { match: ["coachella valley music and arts festival", "coachella"], city: "Indio", country: "US", wikipedia: "Coachella" }),
  festival("stagecoach", "Stagecoach", { match: ["stagecoach festival", "stagecoach country"], city: "Indio", country: "US", wikipedia: "Stagecoach Festival", search: "Stagecoach Festival" }),
  festival("lollapalooza", "Lollapalooza", { city: "Chicago", country: "US", wikipedia: "Lollapalooza" }),
  festival("rolling-loud", "Rolling Loud", { wikipedia: "Rolling Loud", country: "US" }),
  festival("bonnaroo", "Bonnaroo", { match: ["bonnaroo"], city: "Manchester", country: "US", wikipedia: "Bonnaroo Music Festival" }),
  festival("edc-las-vegas", "EDC Las Vegas", { match: ["edc las vegas", "electric daisy carnival las vegas"], city: "Las Vegas", country: "US", wikipedia: "Electric Daisy Carnival", search: "EDC Las Vegas" }),
  festival("edc-orlando", "EDC Orlando", { match: ["edc orlando", "electric daisy carnival orlando"], city: "Orlando", country: "US", wikipedia: "Electric Daisy Carnival", search: "EDC Orlando" }),
  festival("governors-ball", "Governors Ball", { match: ["governors ball"], city: "New York", country: "US", wikipedia: "Governors Ball Music Festival", search: "Governors Ball" }),
  festival("outside-lands", "Outside Lands", { match: ["outside lands"], city: "San Francisco", country: "US", wikipedia: "Outside Lands Music and Arts Festival" }),
  festival("austin-city-limits", "Austin City Limits Music Festival", { match: ["austin city limits music festival", "acl music festival", "acl fest"], city: "Austin", country: "US", wikipedia: "Austin City Limits Music Festival", search: "Austin City Limits Music Festival" }),
  festival("ultra-miami", "Ultra Music Festival", { match: ["ultra music festival"], city: "Miami", country: "US", wikipedia: "Ultra Music Festival" }),
  festival("electric-forest", "Electric Forest", { match: ["electric forest"], city: "Rothbury", country: "US", wikipedia: "Electric Forest Festival" }),
  festival("summerfest", "Summerfest", { match: ["summerfest"], city: "Milwaukee", country: "US", wikipedia: "Summerfest" }),
  festival("new-orleans-jazz-fest", "New Orleans Jazz & Heritage Festival", { match: ["new orleans jazz & heritage festival", "new orleans jazz and heritage festival", "jazz fest"], city: "New Orleans", country: "US", wikipedia: "New Orleans Jazz & Heritage Festival", search: "New Orleans Jazz & Heritage Festival" }),
  festival("essence-festival", "Essence Festival", { match: ["essence festival of culture", "essence festival"], city: "New Orleans", country: "US", wikipedia: "Essence Music Festival", search: "Essence Festival" }),
  festival("when-we-were-young", "When We Were Young", { match: ["when we were young"], city: "Las Vegas", country: "US", wikipedia: "When We Were Young (festival)" }),
  festival("riot-fest", "Riot Fest", { match: ["riot fest"], city: "Chicago", country: "US", wikipedia: "Riot Fest" }),
  festival("shaky-knees", "Shaky Knees", { match: ["shaky knees"], city: "Atlanta", country: "US", wikipedia: "Shaky Knees Music Festival" }),
  festival("boston-calling", "Boston Calling", { match: ["boston calling"], city: "Boston", country: "US", wikipedia: "Boston Calling Music Festival" }),
  festival("pitchfork-music-festival", "Pitchfork Music Festival", { match: ["pitchfork music festival"], country: "US", wikipedia: "Pitchfork Music Festival" }),
  festival("bottlerock", "BottleRock Napa Valley", { match: ["bottlerock"], city: "Napa", country: "US", wikipedia: "BottleRock Napa Valley", search: "BottleRock" }),
  festival("newport-folk", "Newport Folk Festival", { match: ["newport folk festival"], city: "Newport", country: "US", wikipedia: "Newport Folk Festival" }),
  festival("newport-jazz", "Newport Jazz Festival", { match: ["newport jazz festival"], city: "Newport", country: "US", wikipedia: "Newport Jazz Festival" }),
  festival("hard-summer", "HARD Summer", { match: ["hard summer"], country: "US", wikipedia: "Hard (music festival)" }),
  festival("camp-flog-gnaw", "Camp Flog Gnaw Carnival", { match: ["camp flog gnaw"], city: "Los Angeles", country: "US", wikipedia: "Camp Flog Gnaw Carnival", search: "Camp Flog Gnaw" }),
  festival("dreamville-festival", "Dreamville Festival", { match: ["dreamville festival", "dreamville fest"], city: "Raleigh", country: "US", wikipedia: "Dreamville Festival" }),
  festival("life-is-beautiful", "Life Is Beautiful", { match: ["life is beautiful"], city: "Las Vegas", country: "US", wikipedia: "Life Is Beautiful Festival" }),
  festival("louder-than-life", "Louder Than Life", { match: ["louder than life"], city: "Louisville", country: "US", wikipedia: "Louder Than Life" }),
  festival("welcome-to-rockville", "Welcome to Rockville", { match: ["welcome to rockville"], city: "Daytona Beach", country: "US", wikipedia: "Welcome to Rockville" }),
  festival("aftershock", "Aftershock Festival", { match: ["aftershock festival"], city: "Sacramento", country: "US", wikipedia: "Aftershock Festival" }),
  festival("sick-new-world", "Sick New World", { match: ["sick new world"], country: "US", wikipedia: "Sick New World" }),
  festival("lovers-and-friends", "Lovers & Friends", { match: ["lovers & friends", "lovers and friends"], city: "Las Vegas", country: "US", wikipedia: "Lovers & Friends (festival)" }),
  festival("portola", "Portola Music Festival", { match: ["portola music festival", "portola festival"], city: "San Francisco", country: "US", wikipedia: "Portola Music Festival" }),
  festival("all-things-go", "All Things Go", { match: ["all things go"], country: "US", wikipedia: "All Things Go Music Festival" }),
  festival("movement-detroit", "Movement Music Festival", { match: ["movement music festival", "movement detroit"], city: "Detroit", country: "US", wikipedia: "Movement (music festival)", search: "Movement Music Festival" }),
  festival("lost-lands", "Lost Lands", { match: ["lost lands"], country: "US", wikipedia: "Lost Lands Music Festival" }),
  festival("beyond-wonderland", "Beyond Wonderland", { match: ["beyond wonderland"], country: "US", wikipedia: "Beyond Wonderland" }),
  festival("osheaga", "Osheaga", { match: ["osheaga"], city: "Montreal", country: "CA", wikipedia: "Osheaga Festival" }),
  festival("ile-soniq", "ÎLESONIQ", { match: ["ilesoniq", "îlesoniq"], city: "Montreal", country: "CA", wikipedia: "Îlesoniq" }),
  festival("heavy-montreal", "Heavy Montréal", { match: ["heavy montreal", "heavy montréal"], city: "Montreal", country: "CA", wikipedia: "Heavy Montréal" }),
  festival("veld", "Veld Music Festival", { match: ["veld music festival", "veld festival"], city: "Toronto", country: "CA", wikipedia: "Veld Music Festival", search: "Veld" }),
  festival("boots-and-hearts", "Boots and Hearts", { match: ["boots and hearts", "boots & hearts"], city: "Oro-Medonte", country: "CA", wikipedia: "Boots and Hearts Music Festival", identityFamily: "boots-and-hearts" }),
  festival("boots-and-hearts-west", "Boots and Hearts West", { match: ["boots and hearts", "boots & hearts"], city: "Edmonton", country: "CA", identityFamily: "boots-and-hearts", search: "Boots and Hearts West" }),
  festival("festival-d-ete-de-quebec", "Festival d'été de Québec", { match: ["festival d'été de québec", "festival d'ete de quebec"], city: "Quebec City", country: "CA", wikipedia: "Festival d'été de Québec" }),
  festival("glastonbury", "Glastonbury Festival", { match: ["glastonbury festival"], city: "Pilton", country: "GB", wikipedia: "Glastonbury Festival" }),
  festival("reading-and-leeds", "Reading and Leeds Festivals", { match: ["reading festival", "leeds festival", "reading & leeds"], country: "GB", wikipedia: "Reading and Leeds Festivals", search: "Reading Festival" }),
  festival("download-festival", "Download Festival", { match: ["download festival"], city: "Castle Donington", country: "GB", wikipedia: "Download Festival" }),
  festival("wireless-festival", "Wireless Festival", { match: ["wireless festival"], city: "London", country: "GB", wikipedia: "Wireless Festival" }),
  festival("creamfields", "Creamfields", { match: ["creamfields"], country: "GB", wikipedia: "Creamfields" }),
  festival("parklife", "Parklife", { match: ["parklife festival", "parklife 20"], city: "Manchester", country: "GB", wikipedia: "Parklife (festival)", search: "Parklife Festival" }),
  festival("all-points-east", "All Points East", { match: ["all points east"], city: "London", country: "GB", wikipedia: "All Points East" }),
  festival("tomorrowland", "Tomorrowland", { match: ["tomorrowland"], city: "Boom", country: "BE", wikipedia: "Tomorrowland (festival)" }),
  festival("rock-werchter", "Rock Werchter", { match: ["rock werchter"], city: "Werchter", country: "BE", wikipedia: "Rock Werchter" }),
  festival("pukkelpop", "Pukkelpop", { match: ["pukkelpop"], city: "Hasselt", country: "BE", wikipedia: "Pukkelpop" }),
  festival("primavera-sound", "Primavera Sound", { match: ["primavera sound"], city: "Barcelona", country: "ES", wikipedia: "Primavera Sound" }),
  festival("mad-cool", "Mad Cool", { match: ["mad cool"], city: "Madrid", country: "ES", wikipedia: "Mad Cool" }),
  festival("sziget", "Sziget Festival", { match: ["sziget"], city: "Budapest", country: "HU", wikipedia: "Sziget Festival" }),
  festival("roskilde", "Roskilde Festival", { match: ["roskilde festival"], city: "Roskilde", country: "DK", wikipedia: "Roskilde Festival" }),
  festival("rock-in-rio", "Rock in Rio", { match: ["rock in rio"], city: "Rio de Janeiro", country: "BR", wikipedia: "Rock in Rio" }),
  festival("fuji-rock", "Fuji Rock Festival", { match: ["fuji rock"], city: "Yuzawa", country: "JP", wikipedia: "Fuji Rock Festival" }),
  festival("splendour-in-the-grass", "Splendour in the Grass", { match: ["splendour in the grass"], country: "AU", wikipedia: "Splendour in the Grass" }),
  festival("laneway", "Laneway Festival", { match: ["laneway festival"], country: "AU", wikipedia: "St Jerome's Laneway Festival", search: "Laneway Festival" }),
].map((entry) => Object.freeze({ ...entry, exclude: Object.freeze([...COMMON_EXCLUDES, ...entry.exclude]) })));
