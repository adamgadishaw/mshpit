import { cityIdentity,validateCityEditorial } from "./cityValidation.js";

const untouched=row=>row&&Number(row.revision)===0&&row.updated_by==null&&Number(row.updated_at)===0;
function editorialValue(raw) {
  try{return JSON.stringify(validateCityEditorial(typeof raw==="string"?JSON.parse(raw):raw));}catch{return null;}
}

// Legacy defaults have no seed-version column. Only exact, source-controlled old
// values plus untouched moderation metadata are sufficient evidence to upgrade.
export function upgradeCityEditorialSeeds(database,seeds,previousSeeds=[]) {
  const read=database.prepare("SELECT * FROM city_profiles WHERE country_code=? AND city_slug=?");
  const write=database.prepare(`UPDATE city_profiles SET editorial_json=? WHERE country_code=? AND city_slug=?
    AND revision=0 AND updated_by IS NULL AND updated_at=0 AND editorial_json=?`);
  for(const seed of seeds) {
    const identity=cityIdentity(seed.countryCode,seed.city,seed.region);if(!identity)continue;
    const row=read.get(identity.countryCode,identity.citySlug);if(!untouched(row))continue;
    const actual=editorialValue(row.editorial_json);if(!actual)continue;
    const proven=previousSeeds.some(previous=>{
      const previousIdentity=cityIdentity(previous.countryCode,previous.city,previous.region);
      return previousIdentity?.countryCode===identity.countryCode&&previousIdentity.citySlug===identity.citySlug
        && editorialValue(previous.editorial)===actual;
    });
    const next=editorialValue(seed.editorial);
    if(proven&&next&&next!==actual)write.run(next,identity.countryCode,identity.citySlug,row.editorial_json);
  }
}

export function upgradeCityCopyDefaults(database,defaults,previousDefaults={}) {
  const row=database.prepare("SELECT * FROM city_site_copy WHERE id='city'").get();
  if(!untouched(row))return;
  let copy;try{copy=JSON.parse(row.copy_json);}catch{return;}
  if(!copy||Array.isArray(copy)||typeof copy!=="object")return;
  let changed=false;
  for(const [key,value] of Object.entries(defaults)) {
    if(!Object.hasOwn(copy,key)||(Object.hasOwn(previousDefaults,key)&&copy[key]===previousDefaults[key])) {
      if(copy[key]!==value){copy[key]=value;changed=true;}
    }
  }
  if(changed)database.prepare(`UPDATE city_site_copy SET copy_json=? WHERE id='city'
    AND revision=0 AND updated_by IS NULL AND updated_at=0 AND copy_json=?`).run(JSON.stringify(copy),row.copy_json);
}
