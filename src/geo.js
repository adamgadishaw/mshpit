// Location hierarchy: Continent → Country → State/Province/Territory → City.
// Picking from this (instead of free typing) means no spelling mistakes and no
// ambiguous formats. North America is full coverage (all US states + DC, all
// Canadian provinces/territories); the ingest can extend any branch.
export const GEO = {
  "North America": {
    "United States": {
      Alabama: ["Birmingham", "Montgomery", "Huntsville", "Mobile"],
      Alaska: ["Anchorage", "Fairbanks", "Juneau"],
      Arizona: ["Phoenix", "Tucson", "Tempe", "Mesa", "Flagstaff"],
      Arkansas: ["Little Rock", "Fayetteville"],
      California: ["Los Angeles", "San Francisco", "San Diego", "Oakland", "Sacramento", "San Jose", "Long Beach", "Fresno"],
      Colorado: ["Denver", "Colorado Springs", "Boulder", "Morrison", "Fort Collins"],
      Connecticut: ["Hartford", "New Haven", "Bridgeport"],
      Delaware: ["Wilmington", "Dover"],
      "District of Columbia": ["Washington"],
      Florida: ["Miami", "Orlando", "Tampa", "Jacksonville", "Tallahassee", "St. Petersburg"],
      Georgia: ["Atlanta", "Savannah", "Athens"],
      Hawaii: ["Honolulu"],
      Idaho: ["Boise"],
      Illinois: ["Chicago", "Springfield"],
      Indiana: ["Indianapolis", "Bloomington"],
      Iowa: ["Des Moines", "Iowa City"],
      Kansas: ["Wichita", "Kansas City", "Lawrence"],
      Kentucky: ["Louisville", "Lexington"],
      Louisiana: ["New Orleans", "Baton Rouge"],
      Maine: ["Portland", "Bangor"],
      Maryland: ["Baltimore", "Annapolis"],
      Massachusetts: ["Boston", "Cambridge", "Worcester"],
      Michigan: ["Detroit", "Grand Rapids", "Ann Arbor"],
      Minnesota: ["Minneapolis", "St. Paul", "Duluth"],
      Mississippi: ["Jackson"],
      Missouri: ["St. Louis", "Kansas City", "Columbia"],
      Montana: ["Billings", "Missoula", "Bozeman"],
      Nebraska: ["Omaha", "Lincoln"],
      Nevada: ["Las Vegas", "Reno"],
      "New Hampshire": ["Manchester"],
      "New Jersey": ["Newark", "Jersey City", "Atlantic City", "Asbury Park"],
      "New Mexico": ["Albuquerque", "Santa Fe"],
      "New York": ["New York City", "Brooklyn", "Buffalo", "Rochester", "Albany", "Syracuse"],
      "North Carolina": ["Charlotte", "Raleigh", "Durham", "Asheville", "Greensboro"],
      "North Dakota": ["Fargo"],
      Ohio: ["Columbus", "Cleveland", "Cincinnati", "Dayton"],
      Oklahoma: ["Oklahoma City", "Tulsa"],
      Oregon: ["Portland", "Eugene", "Bend"],
      Pennsylvania: ["Philadelphia", "Pittsburgh", "Harrisburg"],
      "Rhode Island": ["Providence"],
      "South Carolina": ["Charleston", "Columbia", "Greenville"],
      "South Dakota": ["Sioux Falls"],
      Tennessee: ["Nashville", "Memphis", "Knoxville", "Chattanooga"],
      Texas: ["Austin", "Dallas", "Houston", "San Antonio", "Fort Worth", "El Paso"],
      Utah: ["Salt Lake City", "Provo"],
      Vermont: ["Burlington"],
      Virginia: ["Richmond", "Virginia Beach", "Norfolk", "Charlottesville"],
      Washington: ["Seattle", "Tacoma", "Spokane"],
      "West Virginia": ["Charleston", "Morgantown"],
      Wisconsin: ["Milwaukee", "Madison", "Green Bay"],
      Wyoming: ["Cheyenne", "Jackson"],
    },
    Canada: {
      Alberta: ["Calgary", "Edmonton", "Banff"],
      "British Columbia": ["Vancouver", "Victoria", "Kelowna"],
      Manitoba: ["Winnipeg"],
      "New Brunswick": ["Moncton", "Fredericton", "Saint John"],
      "Newfoundland and Labrador": ["St. John's"],
      "Northwest Territories": ["Yellowknife"],
      "Nova Scotia": ["Halifax"],
      Nunavut: ["Iqaluit"],
      Ontario: ["Toronto", "Mississauga", "Ottawa", "Hamilton", "Kitchener", "Guelph", "London", "Kingston", "Windsor", "Sudbury", "Thunder Bay"],
      "Prince Edward Island": ["Charlottetown"],
      Quebec: ["Montreal", "Laval", "Quebec City", "Gatineau", "Sherbrooke"],
      Saskatchewan: ["Saskatoon", "Regina"],
      Yukon: ["Whitehorse"],
    },
    Mexico: {
      "Mexico City": ["Mexico City"],
      Jalisco: ["Guadalajara"],
      "Nuevo León": ["Monterrey"],
    },
  },
  Europe: {
    "United Kingdom": { England: ["London", "Manchester", "Birmingham", "Leeds"], Scotland: ["Glasgow", "Edinburgh"] },
    Germany: { Berlin: ["Berlin"], Bavaria: ["Munich"], Hamburg: ["Hamburg"] },
    France: { "Île-de-France": ["Paris"] },
    Netherlands: { "North Holland": ["Amsterdam"] },
    Spain: { Madrid: ["Madrid"], Catalonia: ["Barcelona"] },
    Sweden: { Stockholm: ["Stockholm"] },
    Ireland: { Leinster: ["Dublin"] },
  },
  Asia: {
    Japan: { Tokyo: ["Tokyo"], Osaka: ["Osaka"] },
    "South Korea": { Seoul: ["Seoul"] },
    Singapore: { Singapore: ["Singapore"] },
  },
  Oceania: {
    Australia: { "New South Wales": ["Sydney"], Victoria: ["Melbourne"], Queensland: ["Brisbane"] },
    "New Zealand": { Auckland: ["Auckland"] },
  },
  "South America": {
    Brazil: { "São Paulo": ["São Paulo"], "Rio de Janeiro": ["Rio de Janeiro"] },
    Argentina: { "Buenos Aires": ["Buenos Aires"] },
  },
};

// "City, State, Country" - the canonical display string.
export function formatPlace({ continent, country, state, city }) {
  if (!city) return "";
  const bits = [city];
  if (state && state !== city) bits.push(state);
  if (country) bits.push(country);
  return bits.join(", ");
}
