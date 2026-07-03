// Major arenas, stadiums & amphitheatres across Canada + the USA — the flagship
// rooms artists actually headline. These were missing because MusicBrainz files
// them under place types "Indoor arena" / "Stadium", not "Venue", so the scraper's
// `type:Venue` filter skipped them (now widened too — see scripts/ingest-*.mjs).
//
// Curated facts (name, city, coordinates, capacity) are public/uncopyrighted, so
// seeding them guarantees artists can attach performances to the right room today.
// Keyed by lowercase name; merged into catalogVenues in catalog.js.
const V = (name, place, lat, lng, capacity) => [name.toLowerCase(), { name, place, lat, lng, capacity, photo: null, photoCredit: null, major: true }];

export const arenaVenues = Object.fromEntries([
  // --- Canada ---
  V("Scotiabank Arena", "Toronto, Ontario, Canada", 43.6435, -79.3791, 19800),
  V("Rogers Centre", "Toronto, Ontario, Canada", 43.6414, -79.3894, 53506),
  V("Budweiser Stage", "Toronto, Ontario, Canada", 43.6289, -79.4158, 16000),
  V("Coca-Cola Coliseum", "Toronto, Ontario, Canada", 43.6360, -79.4136, 8500),
  V("History", "Toronto, Ontario, Canada", 43.6640, -79.3300, 2500),
  V("Bell Centre", "Montreal, Quebec, Canada", 45.4961, -73.5693, 21105),
  V("Place Bell", "Laval, Quebec, Canada", 45.5709, -73.7492, 10062),
  V("Videotron Centre", "Quebec City, Quebec, Canada", 46.8312, -71.2447, 18259),
  V("Canadian Tire Centre", "Ottawa, Ontario, Canada", 45.2969, -75.9273, 18652),
  V("Rogers Arena", "Vancouver, British Columbia, Canada", 49.2778, -123.1089, 18910),
  V("BC Place", "Vancouver, British Columbia, Canada", 49.2766, -123.1119, 54500),
  V("Rogers Place", "Edmonton, Alberta, Canada", 53.5469, -113.4977, 18347),
  V("Scotiabank Saddledome", "Calgary, Alberta, Canada", 51.0374, -114.0519, 19289),
  V("Canada Life Centre", "Winnipeg, Manitoba, Canada", 49.8927, -97.1436, 15321),
  V("SaskTel Centre", "Saskatoon, Saskatchewan, Canada", 52.1550, -106.5960, 15195),
  V("Brandt Centre", "Regina, Saskatchewan, Canada", 50.4300, -104.5650, 7723),
  V("FirstOntario Centre", "Hamilton, Ontario, Canada", 43.2560, -79.8690, 17383),
  V("Avenir Centre", "Moncton, New Brunswick, Canada", 46.0885, -64.7782, 8800),
  V("Scotiabank Centre", "Halifax, Nova Scotia, Canada", 44.6470, -63.5754, 10595),
  V("Mary Brown's Centre", "St. John's, Newfoundland and Labrador, Canada", 47.5620, -52.7126, 6287),
  // --- USA ---
  V("MetLife Stadium", "East Rutherford, New Jersey, United States", 40.8135, -74.0745, 82500),
  V("Barclays Center", "Brooklyn, New York, United States", 40.6826, -73.9754, 19000),
  V("Crypto.com Arena", "Los Angeles, California, United States", 34.0430, -118.2673, 20000),
  V("SoFi Stadium", "Inglewood, California, United States", 33.9535, -118.3392, 70240),
  V("Kia Forum", "Inglewood, California, United States", 33.9583, -118.3417, 17505),
  V("Hollywood Bowl", "Los Angeles, California, United States", 34.1122, -118.3391, 17500),
  V("Chase Center", "San Francisco, California, United States", 37.7680, -122.3877, 18064),
  V("United Center", "Chicago, Illinois, United States", 41.8807, -87.6742, 23500),
  V("TD Garden", "Boston, Massachusetts, United States", 42.3662, -71.0621, 19580),
  V("Wells Fargo Center", "Philadelphia, Pennsylvania, United States", 39.9012, -75.1720, 21000),
  V("Capital One Arena", "Washington, District of Columbia, United States", 38.8981, -77.0209, 20356),
  V("State Farm Arena", "Atlanta, Georgia, United States", 33.7573, -84.3963, 21000),
  V("American Airlines Center", "Dallas, Texas, United States", 32.7905, -96.8103, 20000),
  V("Toyota Center", "Houston, Texas, United States", 29.7508, -95.3621, 18055),
  V("Moody Center", "Austin, Texas, United States", 30.2830, -97.7320, 15000),
  V("Ball Arena", "Denver, Colorado, United States", 39.7487, -105.0077, 19520),
  V("Climate Pledge Arena", "Seattle, Washington, United States", 47.6221, -122.3540, 18100),
  V("Moda Center", "Portland, Oregon, United States", 45.5316, -122.6668, 19980),
  V("Little Caesars Arena", "Detroit, Michigan, United States", 42.3411, -83.0553, 20332),
  V("Fiserv Forum", "Milwaukee, Wisconsin, United States", 43.0451, -87.9172, 17500),
  V("T-Mobile Arena", "Las Vegas, Nevada, United States", 36.1029, -115.1783, 20000),
  V("Footprint Center", "Phoenix, Arizona, United States", 33.4457, -112.0712, 16645),
  V("Kaseya Center", "Miami, Florida, United States", 25.7814, -80.1870, 19600),
  V("Xcel Energy Center", "Saint Paul, Minnesota, United States", 44.9447, -93.1010, 17954),
]);
