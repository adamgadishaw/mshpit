import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ensureCitySchema } from "./citySchema.js";
import { cityIdentity,validateCityEditorial,validateCityCopy } from "./cityValidation.js";
import { CITY_EDITORIAL_SEEDS,CITY_EDITORIAL_PREVIOUS_SEEDS } from "./cityEditorialSeeds.js";
import { DEFAULT_CITY_COPY,CITY_COPY_PREVIOUS_DEFAULTS } from "./cityCopy.js";

function fixture() {
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('admin');
    CREATE TABLE tour_dates(id TEXT,venue TEXT,venue_city TEXT,venue_country_code TEXT,date TEXT);`);
  ensureCitySchema(db,{venues:[],seeds:[],previousSeeds:[],banner:null,geo:{}});
  return db;
}
const current=CITY_EDITORIAL_SEEDS.find(seed=>seed.city==="Toronto");
const previous=CITY_EDITORIAL_PREVIOUS_SEEDS.find(seed=>seed.city==="Toronto");
const identity=cityIdentity(current.countryCode,current.city,current.region);
function oldRow(db,{revision=0,at=0,by=null,editorial=previous.editorial}={}) {
  db.prepare(`INSERT INTO city_profiles(country_code,city_slug,city,country,editorial_json,revision,updated_at,updated_by)
    VALUES (?,?,?,'Canada',?,?,?,?)`).run(identity.countryCode,identity.citySlug,identity.city,JSON.stringify(editorial),revision,at,by);
}
const read=db=>db.prepare("SELECT * FROM city_profiles WHERE country_code='CA' AND city_slug='toronto'").get();
const upgrade=db=>ensureCitySchema(db,{venues:[],seeds:[current],banner:null,geo:{}});

test("all 21 sourced city guides have separate descriptive search copy and a restrained visible title",()=>{
  assert.equal(CITY_EDITORIAL_SEEDS.length,21);
  for(const seed of CITY_EDITORIAL_SEEDS) {
    const value=validateCityEditorial(seed.editorial);
    assert.ok(cityIdentity(seed.countryCode,seed.city,seed.region),seed.city);
    assert.ok(value.seoTitle.length>=25&&value.seoTitle.length<=80,seed.city);
    assert.ok(value.seoDescription.length>=90&&value.seoDescription.length<=200,seed.city);
    assert.match(value.seoTitle,/concerts/i,seed.city);
    assert.match(value.seoDescription,/venues/i,seed.city);
    assert.notEqual(value.title,value.seoTitle,seed.city);
    assert.equal(value.title,`${seed.city}, live`);
    assert.doesNotMatch(value.intro,/music story|reviews from the room|stories behind|see the night through/i);
    assert.ok(value.sources.length>0,seed.city);
    assert.doesNotMatch(value.title+" "+value.intro+" "+value.seoDescription,/ultimate|unleash|dive into|vibrant tapestry|best concerts|top-rated/i);
  }
});

test("editorial SEO fields are optional, bounded plain text",()=>{
  assert.equal(validateCityEditorial({}).seoTitle,"");
  assert.equal(validateCityEditorial({seoTitle:"A concert guide",seoDescription:"An accurate summary."}).seoDescription,"An accurate summary.");
  assert.throws(()=>validateCityEditorial({seoTitle:"x".repeat(81)}),/80/);
  assert.throws(()=>validateCityEditorial({seoDescription:"x".repeat(201)}),/200/);
  assert.throws(()=>validateCityCopy({citySeoTitle:"x".repeat(81)}),/80/);
  assert.throws(()=>validateCityCopy({citySeoDescription:"x".repeat(201)}),/200/);
  assert.throws(()=>validateCityEditorial({seoTitle:"Bad\u0000title"}),/Search title/);
});

test("an exact untouched original city seed receives the revised text and SEO fields only once",()=>{
  const db=fixture();oldRow(db);upgrade(db);
  const result=read(db),value=JSON.parse(result.editorial_json);
  assert.equal(value.title,current.editorial.title);
  assert.equal(value.seoTitle,current.editorial.seoTitle);
  assert.equal(value.history,previous.editorial.history);
  assert.equal(result.revision,0);
  upgrade(db);assert.deepEqual(read(db),result);db.close();
});

test("seed upgrades never overwrite moderator or unexplained changes, even with a legacy zero revision",()=>{
  for(const options of [
    {revision:1},
    {by:"admin"},
    {at:1},
    {editorial:{...previous.editorial,intro:"A moderator changed this sentence."}},
    {editorial:{...previous.editorial,unknownFutureField:"Keep it"}},
  ]) {
    const db=fixture();oldRow(db,options);const before=read(db);
    upgrade(db);assert.deepEqual(read(db),before,JSON.stringify(options));db.close();
  }
});

test("shared default upgrades replace only exact old values and add new managed keys",()=>{
  const db=fixture(),old={...CITY_COPY_PREVIOUS_DEFAULTS,welcomeTitle:"Our custom welcome",welcomeBannerUrl:"https://images.mshpit.com/owned.jpg"};
  db.prepare("UPDATE city_site_copy SET copy_json=? WHERE id='city'").run(JSON.stringify(old));
  ensureCitySchema(db,{venues:[],seeds:[],previousSeeds:[],banner:null,geo:{}});
  const next=JSON.parse(db.prepare("SELECT copy_json FROM city_site_copy").get().copy_json);
  assert.equal(next.cityTitle,DEFAULT_CITY_COPY.cityTitle);
  assert.equal(next.citySeoTitle,DEFAULT_CITY_COPY.citySeoTitle);
  assert.equal(next.programmeLabel,"City programme");
  assert.equal(next.welcomeTitle,"Our custom welcome");
  assert.equal(next.welcomeBannerUrl,old.welcomeBannerUrl);
  db.close();
});

test("moderated shared copy remains byte-for-byte untouched by startup",()=>{
  for(const [revision,at,by] of [[1,0,null],[0,1,null],[0,0,"admin"]]) {
    const db=fixture(),raw=JSON.stringify(CITY_COPY_PREVIOUS_DEFAULTS);
    db.prepare("UPDATE city_site_copy SET copy_json=?,revision=?,updated_at=?,updated_by=?").run(raw,revision,at,by);
    ensureCitySchema(db,{venues:[],seeds:[],previousSeeds:[],banner:null,geo:{}});
    assert.equal(db.prepare("SELECT copy_json FROM city_site_copy").get().copy_json,raw);
    db.close();
  }
});

test("the moderation editor binds both SEO fields with the server limits",()=>{
  const source=readFileSync(new URL("../../../src/components/moderation/CityPagesConsole.jsx",import.meta.url),"utf8");
  assert.match(source,/label="Search title" value=\{editorial\.seoTitle\}[^\n]*limit=\{80\}/);
  assert.match(source,/label="Search description" value=\{editorial\.seoDescription\}[^\n]*limit=\{200\}/);
});
