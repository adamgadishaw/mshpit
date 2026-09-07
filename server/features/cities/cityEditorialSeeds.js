// Initial, source-backed copy. Stored only for untouched rows; moderation owns edits.
import { CITY_STOCK_IMAGES, CITY_DEFAULT_WELCOME_PHOTO } from "./cityPhotoSeeds.js";
import { CITY_EDITORIAL_ADDITIONAL_SEEDS } from "./cityEditorialAdditionalSeeds.js";
import { slugify } from "../../../src/domain/urls.mjs";
import { CITY_EDITORIAL_REFRESH } from "./cityEditorialRefresh.js";
const originalSeeds = [
  {
    "countryCode": "CA",
    "city": "Toronto",
    "editorial": {
      "title": "Music in Toronto",
      "intro": "Toronto’s music history runs from the folk clubs of Yorkville to the city’s hip-hop and R&B artists.",
      "history": "Gordon Lightfoot and The Weeknd are among the musicians recognized by the City of Toronto. Their work spans generations of Canadian songwriting and recording.",
      "influence": "The city is a major Canadian centre for recording, live performance, and music businesses.",
      "timeZone": "America/Toronto",
      "sources": [
        {
          "title": "City of Toronto: Key to the City",
          "url": "https://www.toronto.ca/city-government/awards-tributes/awards/key-to-the-city/"
        }
      ],
      "artists": [
        {
          "name": "Gordon Lightfoot",
          "description": "Part of Toronto’s music history.",
          "sourceUrl": "https://www.toronto.ca/city-government/awards-tributes/awards/key-to-the-city/"
        },
        {
          "name": "The Weeknd",
          "description": "Part of Toronto’s music history.",
          "sourceUrl": "https://www.toronto.ca/city-government/awards-tributes/awards/key-to-the-city/"
        }
      ],
      "stockImage": null
    }
  },
  {
    "countryCode": "US",
    "city": "Nashville",
    "editorial": {
      "title": "Music in Nashville",
      "intro": "Nashville’s music story includes spirituals, country, R&B, and the songwriters of Music Row.",
      "history": "The Fisk Jubilee Singers began touring in 1871. WSM and the Grand Ole Opry followed in 1925, helping bring Nashville performances to radio audiences.",
      "influence": "Music publishing, studios, and venues such as the Ryman made Nashville a meeting place for writers and performers.",
      "timeZone": "America/Chicago",
      "sources": [
        {
          "title": "Visit Music City: Nashville’s music history",
          "url": "https://www.visitmusiccity.com/nashville-trip-ideas/story-nashvilles-music-history"
        }
      ],
      "artists": [
        {
          "name": "Fisk Jubilee Singers",
          "description": "Part of Nashville’s music history.",
          "sourceUrl": "https://www.visitmusiccity.com/nashville-trip-ideas/story-nashvilles-music-history"
        },
        {
          "name": "Johnny Cash",
          "description": "Part of Nashville’s music history.",
          "sourceUrl": "https://www.visitmusiccity.com/nashville-trip-ideas/story-nashvilles-music-history"
        }
      ],
      "stockImage": null
    }
  },
  {
    "countryCode": "GB",
    "city": "London",
    "editorial": {
      "title": "Music in London",
      "intro": "London’s clubs, studios, and concert halls have hosted generations of musicians.",
      "history": "The Marquee Club hosted acts including The Who and Pink Floyd. The 100 Club is another long-running part of London’s live music history.",
      "influence": "Small clubs and major stages gave British artists places to develop their work and reach wider audiences.",
      "timeZone": "Europe/London",
      "sources": [
        {
          "title": "Visit London: Music in London",
          "url": "https://www.visitlondon.com/things-to-do/whats-on/music/music-things-to-do-in-london"
        }
      ],
      "artists": [
        {
          "name": "The Who",
          "description": "Part of London’s music history.",
          "sourceUrl": "https://www.visitlondon.com/things-to-do/whats-on/music/music-things-to-do-in-london"
        },
        {
          "name": "Pink Floyd",
          "description": "Part of London’s music history.",
          "sourceUrl": "https://www.visitlondon.com/things-to-do/whats-on/music/music-things-to-do-in-london"
        }
      ],
      "stockImage": null
    }
  },
  {
    "countryCode": "GB",
    "city": "Liverpool",
    "editorial": {
      "title": "Music in Liverpool",
      "intro": "Liverpool’s music history includes the Beatles, orchestral music, and a long festival tradition.",
      "history": "The city is known internationally for the Beatles and is home to the Royal Liverpool Philharmonic Orchestra.",
      "influence": "Festivals including Africa Oyé and Liverpool Sound City have brought different styles and new performers to local audiences.",
      "timeZone": "Europe/London",
      "sources": [
        {
          "title": "UNESCO: Liverpool",
          "url": "https://www.unesco.org/en/creative-cities/liverpool"
        }
      ],
      "artists": [
        {
          "name": "The Beatles",
          "description": "Part of Liverpool’s music history.",
          "sourceUrl": "https://www.unesco.org/en/creative-cities/liverpool"
        }
      ],
      "stockImage": null
    }
  },
  {
    "countryCode": "GB",
    "city": "Glasgow",
    "editorial": {
      "title": "Music in Glasgow",
      "intro": "Glasgow has a long concert tradition across rock, pop, electronic, and classical music.",
      "history": "The city joined UNESCO’s music network in 2008. Its music venues and the Royal Conservatoire of Scotland are central parts of that history.",
      "influence": "Glasgow’s live music industry and music schools connect working musicians with new performers.",
      "timeZone": "Europe/London",
      "sources": [
        {
          "title": "UNESCO: Glasgow",
          "url": "https://www.unesco.org/en/creative-cities/glasgow"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  },
  {
    "countryCode": "JM",
    "city": "Kingston",
    "editorial": {
      "title": "Music in Kingston",
      "intro": "Kingston’s studios and musicians helped shape ska, rocksteady, reggae, and dancehall.",
      "history": "Bob Marley and Dennis Brown are closely associated with the city. Recording studios and production houses helped take Jamaican music around the world.",
      "influence": "Kingston’s recordings, sound systems, and live performances have had a lasting influence well beyond Jamaica.",
      "timeZone": "America/Jamaica",
      "sources": [
        {
          "title": "UNESCO: Kingston",
          "url": "https://www.unesco.org/en/creative-cities/kingston"
        }
      ],
      "artists": [
        {
          "name": "Bob Marley",
          "description": "Part of Kingston’s music history.",
          "sourceUrl": "https://www.unesco.org/en/creative-cities/kingston"
        },
        {
          "name": "Dennis Brown",
          "description": "Part of Kingston’s music history.",
          "sourceUrl": "https://www.unesco.org/en/creative-cities/kingston"
        }
      ],
      "stockImage": null
    }
  },
  {
    "countryCode": "CO",
    "city": "Bogotá",
    "editorial": {
      "title": "Music in Bogotá",
      "intro": "Bogotá’s music includes rock, salsa, jazz, hip-hop, and opera.",
      "history": "The Festivales al Parque programme began in 1995 with free outdoor concerts. It made public parks important places to hear local artists.",
      "influence": "These festivals gave broad audiences access to live music and helped connect performers across styles.",
      "timeZone": "America/Bogota",
      "sources": [
        {
          "title": "UNESCO: Bogotá",
          "url": "https://www.unesco.org/en/creative-cities/bogota"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  },
  {
    "countryCode": "US",
    "city": "Kansas City",
    "editorial": {
      "title": "Music in Kansas City",
      "intro": "Kansas City is closely tied to the history of jazz.",
      "history": "Jazz developed here through clubs, working bands, and musicians who carried the city’s sound beyond Missouri.",
      "influence": "The city joined UNESCO’s music network in 2017, recognizing music as an important part of its cultural life.",
      "timeZone": "America/Chicago",
      "sources": [
        {
          "title": "UNESCO: Kansas City",
          "url": "https://www.unesco.org/en/creative-cities/kansas-city"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  },
  {
    "countryCode": "AU",
    "city": "Adelaide",
    "editorial": {
      "title": "Music in Adelaide",
      "intro": "Adelaide’s music scene includes concert venues, local bands, and international festivals.",
      "history": "WOMADelaide and the Adelaide Festival Centre have brought musicians from different countries to South Australia.",
      "influence": "Festivals and exchanges with artists across Asia have connected the city’s performers with wider audiences.",
      "timeZone": "Australia/Adelaide",
      "sources": [
        {
          "title": "UNESCO: Adelaide",
          "url": "https://www.unesco.org/en/creative-cities/adelaide"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  },
  {
    "countryCode": "NZ",
    "city": "Auckland",
    "editorial": {
      "title": "Music in Auckland",
      "intro": "Auckland’s music draws on Māori heritage and the city’s many communities.",
      "history": "The city has been a base for recording studios, labels, and music organisations. Free Music in Parks concerts have also given local artists public stages.",
      "influence": "Māori artists and local performers are central to the city’s music heritage and its links with the South Pacific.",
      "timeZone": "Pacific/Auckland",
      "sources": [
        {
          "title": "UNESCO: Auckland",
          "url": "https://www.unesco.org/en/creative-cities/auckland"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  },
  {
    "countryCode": "DE",
    "city": "Hannover",
    "editorial": {
      "title": "Music in Hannover",
      "intro": "Hannover’s music history includes both performance and sound recording.",
      "history": "Recording formats and manufacturing are part of the city’s musical past. The city also has institutions for music training.",
      "influence": "Work in recording and acoustic technology connects Hannover’s music industry with its musicians and researchers.",
      "timeZone": "Europe/Berlin",
      "sources": [
        {
          "title": "UNESCO: Hannover",
          "url": "https://www.unesco.org/en/creative-cities/hannover"
        }
      ],
      "artists": [],
      "stockImage": null
    }
  }
];

originalSeeds.push(...CITY_EDITORIAL_ADDITIONAL_SEEDS);
for (const seed of originalSeeds) {
  const photoCity = seed.countryCode === "US" && seed.city === "New York" ? "New York City" : seed.city;
  const key = Object.keys(CITY_STOCK_IMAGES).find((value) => value.startsWith(`${seed.countryCode}:`) && slugify(value.split(":")[1]) === slugify(photoCity));
  seed.editorial.stockImage = key ? CITY_STOCK_IMAGES[key] : null;
}
// Preserve the exact previously shipped values as an upgrade proof, not as another live source of copy.
export const CITY_EDITORIAL_PREVIOUS_SEEDS = originalSeeds.flatMap(seed => [
  structuredClone(seed), {...structuredClone(seed),editorial:{...structuredClone(seed.editorial),stockImage:null}},
]);
export const CITY_EDITORIAL_SEEDS = originalSeeds.map(seed => ({...seed,
  ...(seed.countryCode==="US"&&seed.city==="Kansas City"?{region:"Missouri"}:{}),
  editorial:{...seed.editorial,...CITY_EDITORIAL_REFRESH[`${seed.countryCode}:${seed.city}`]},
}));
export const CITY_WELCOME_BANNER = CITY_DEFAULT_WELCOME_PHOTO;
