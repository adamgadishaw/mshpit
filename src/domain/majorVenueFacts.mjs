// Major arenas, stadiums & amphitheatres across North America and Europe: the
// flagship rooms artists actually headline. Curated anchors keep those places in
// the catalog even when an upstream source classifies them as arenas or stadiums.
//
// Curated facts (name, city, coordinates, capacity) are public/uncopyrighted, so
// seeding them guarantees artists can attach performances to the right room today.
// Keyed by lowercase name; merged into catalogVenues in catalog.js.
const V = (name, place, lat, lng, capacity) => [name.toLowerCase(), { name, place, lat, lng, capacity, photo: null, photoCredit: null, major: true }];

export const arenaVenueEntries = [
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

  // --- Portugal ---
  V("MEO Arena", "Lisbon, Portugal", 38.7686, -9.0947, 12500),
  V("Estádio da Luz", "Lisbon, Portugal", 38.7527, -9.1847, 68100),
  V("Estádio José Alvalade", "Lisbon, Portugal", 38.7612, -9.1608, 50095),
  V("Estádio do Dragão", "Porto, Portugal", 41.1618, -8.5839, 50033),
  V("Super Bock Arena", "Porto, Portugal", 41.1488, -8.6260, 8000),

  // --- Spain ---
  V("Riyadh Air Metropolitano", "Madrid, Spain", 40.4362, -3.5995, 70700),
  V("Movistar Arena Madrid", "Madrid, Spain", 40.4239, -3.6718, 18000),
  V("Estadio Santiago Bernabéu", "Madrid, Spain", 40.4531, -3.6883, 80242),
  V("Spotify Camp Nou", "Barcelona, Spain", 41.3809, 2.1228, 62652),
  V("Estadi Olímpic Lluís Companys", "Barcelona, Spain", 41.3648, 2.1557, 55926),
  V("Palau Sant Jordi", "Barcelona, Spain", 41.3634, 2.1526, 17960),
  V("Estadio La Cartuja", "Seville, Spain", 37.4172, -6.0045, 70000),
  V("Roig Arena", "Valencia, Spain", 39.4529, -0.3665, 18300),

  // --- United Kingdom ---
  V("Wembley Stadium", "London, United Kingdom", 51.5560, -0.2796, 90000),
  V("The O2 Arena", "London, United Kingdom", 51.5030, 0.0032, 20000),
  V("Tottenham Hotspur Stadium", "London, United Kingdom", 51.6043, -0.0664, 62850),
  V("London Stadium", "London, United Kingdom", 51.5386, -0.0166, 60000),
  V("Co-op Live", "Manchester, United Kingdom", 53.4881, -2.1993, 23500),
  V("AO Arena", "Manchester, United Kingdom", 53.4880, -2.2440, 23000),
  V("OVO Hydro", "Glasgow, United Kingdom", 55.8609, -4.2850, 14300),
  V("Principality Stadium", "Cardiff, United Kingdom", 51.4782, -3.1826, 73931),

  // --- Ireland ---
  V("Croke Park", "Dublin, Ireland", 53.3607, -6.2510, 82300),
  V("Aviva Stadium", "Dublin, Ireland", 53.3352, -6.2285, 51700),
  V("3Arena Dublin", "Dublin, Ireland", 53.3475, -6.2285, 13000),

  // --- France ---
  V("Stade de France", "Saint-Denis, France", 48.9245, 2.3601, 80000),
  V("Paris La Défense Arena", "Nanterre, France", 48.8957, 2.2304, 40000),
  V("Accor Arena", "Paris, France", 48.8386, 2.3786, 20300),
  V("Groupama Stadium", "Décines-Charpieu, France", 45.7653, 4.9820, 59186),
  V("Orange Vélodrome", "Marseille, France", 43.2698, 5.3959, 67394),
  V("LDLC Arena", "Décines-Charpieu, France", 45.7695, 4.9904, 16000),

  // --- Germany ---
  V("Olympiastadion Berlin", "Berlin, Germany", 52.5147, 13.2395, 74475),
  V("Uber Arena", "Berlin, Germany", 52.5065, 13.4433, 17000),
  V("Olympiastadion München", "Munich, Germany", 48.1731, 11.5466, 69250),
  V("LANXESS arena", "Cologne, Germany", 50.9386, 6.9829, 20000),
  V("Barclays Arena", "Hamburg, Germany", 53.5898, 9.8992, 15000),
  V("Merkur Spiel-Arena", "Düsseldorf, Germany", 51.2616, 6.7332, 54600),
  V("VELTINS-Arena", "Gelsenkirchen, Germany", 51.5546, 7.0676, 62271),

  // --- Italy ---
  V("Stadio San Siro", "Milan, Italy", 45.4781, 9.1240, 75817),
  V("Stadio Olimpico", "Rome, Italy", 41.9339, 12.4547, 70634),
  V("Unipol Forum", "Assago, Italy", 45.4014, 9.1434, 15800),
  V("Inalpi Arena", "Turin, Italy", 45.0417, 7.6522, 15657),
  V("Arena di Verona", "Verona, Italy", 45.4384, 10.9946, 15000),
  V("RCF Arena", "Reggio Emilia, Italy", 44.7148, 10.6493, 100000),

  // --- Netherlands ---
  V("Johan Cruijff ArenA", "Amsterdam, Netherlands", 52.3143, 4.9419, 55885),
  V("Ziggo Dome", "Amsterdam, Netherlands", 52.3134, 4.9377, 18000),
  V("GelreDome", "Arnhem, Netherlands", 51.9629, 5.8939, 34000),
  V("Rotterdam Ahoy", "Rotterdam, Netherlands", 51.8820, 4.4884, 16426),

  // --- Belgium ---
  V("AFAS Dome", "Antwerp, Belgium", 51.2311, 4.4411, 23001),
  V("ING Arena", "Brussels, Belgium", 50.8998, 4.3373, 12000),
  V("King Baudouin Stadium", "Brussels, Belgium", 50.8950, 4.3347, 50093),

  // --- Switzerland ---
  V("Hallenstadion Zürich", "Zürich, Switzerland", 47.4115, 8.5517, 15000),
  V("Stadion Letzigrund", "Zürich, Switzerland", 47.3828, 8.5040, 26104),

  // --- Austria ---
  V("Ernst Happel Stadion", "Vienna, Austria", 48.2072, 16.4209, 50865),
  V("Wiener Stadthalle", "Vienna, Austria", 48.2025, 16.3325, 16000),

  // --- Denmark ---
  V("Parken Stadium", "Copenhagen, Denmark", 55.7027, 12.5722, 38065),
  V("Royal Arena", "Copenhagen, Denmark", 55.6252, 12.5738, 17000),

  // --- Sweden ---
  V("Strawberry Arena", "Solna, Sweden", 59.3725, 18.0004, 60000),
  V("3Arena Stockholm", "Stockholm, Sweden", 59.2908, 18.0853, 40000),
  V("Avicii Arena", "Stockholm, Sweden", 59.2936, 18.0836, 15000),

  // --- Norway ---
  V("Unity Arena", "Fornebu, Norway", 59.9020, 10.6247, 25000),
  V("Oslo Spektrum", "Oslo, Norway", 59.9121, 10.7543, 11500),

  // --- Finland ---
  V("Helsinki Olympic Stadium", "Helsinki, Finland", 60.1870, 24.9272, 36200),
  V("Nokia Arena", "Tampere, Finland", 61.4930, 23.7730, 15000),

  // --- Poland ---
  V("PGE Narodowy", "Warsaw, Poland", 52.2394, 21.0452, 58580),
  V("TAURON Arena Kraków", "Kraków, Poland", 50.0679, 19.9917, 22000),
  V("Atlas Arena", "Łódź, Poland", 51.7576, 19.4250, 13805),

  // --- Czechia ---
  V("O2 Arena Prague", "Prague, Czechia", 50.1047, 14.4936, 20000),
  V("Fortuna Arena", "Prague, Czechia", 50.0675, 14.4717, 19370),
];

export const arenaVenues = Object.fromEntries(arenaVenueEntries);
