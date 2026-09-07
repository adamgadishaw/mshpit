import { GEO } from "./geo.mjs";
import { slugify } from "./urls.mjs";

const regionCodes=Object.fromEntries("AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|ON:Ontario|QC:Quebec|BC:British Columbia|AB:Alberta|MB:Manitoba|NB:New Brunswick|NL:Newfoundland and Labrador|NS:Nova Scotia|NT:Northwest Territories|NU:Nunavut|PE:Prince Edward Island|SK:Saskatchewan|YT:Yukon".split("|").map(entry=>entry.split(":")));
const displayNames=new Intl.DisplayNames(["en"],{type:"region"}),countries=new Map();
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++) {
  const code=String.fromCharCode(a,b),name=displayNames.of(code);
  if(name!==code)countries.set(name.toLowerCase(),code);
}
for(const [name,code] of [["united states","US"],["united kingdom","GB"],["south korea","KR"],["czech republic","CZ"]])countries.set(name,code);
const knownRegions=new Map();
for(const continent of Object.values(GEO))for(const [country,regions] of Object.entries(continent)) {
  const code=countries.get(country.toLowerCase());if(!code)continue;
  for(const [region,names] of Object.entries(regions))for(const city of names) {
    const key=`${code}/${slugify(city)}`,entries=knownRegions.get(key)||new Set();entries.add(region);knownRegions.set(key,entries);
  }
}
const cityAliases=Object.freeze({
  "JP/東京":"Tokyo","JP/東京都":"Tokyo","JP/大阪":"Osaka","JP/大阪市":"Osaka","JP/京都":"Kyoto","JP/京都市":"Kyoto",
  "JP/横浜":"Yokohama","JP/名古屋":"Nagoya","KR/서울":"Seoul","KR/서울특별시":"Seoul","KR/부산":"Busan",
  "CN/北京":"Beijing","CN/上海":"Shanghai","TW/臺北":"Taipei","TW/台北":"Taipei","TH/กรุงเทพมหานคร":"Bangkok",
});
export function cityIdentity(countryCode,city,region="") {
  const code=String(countryCode||"").trim().toUpperCase(),raw=String(city||"").trim();
  const name=cityAliases[`${code}/${raw}`]||raw;
  if(!/^[A-Z]{2}$/.test(code)||!name||name.length>160)return null;
  const base=slugify(name)||`u-${Array.from(name.normalize("NFC")).map(c=>c.codePointAt(0).toString(16)).join("-")}`;
  const regionRaw=String(region||"").trim().replace(new RegExp(`^${code}[- ]`,"i"),"");
  const normalizedRegion=(code==="US"||code==="CA") ? regionCodes[regionRaw.toUpperCase()]||regionRaw : regionRaw;
  const matches=knownRegions.get(`${code}/${base}`),ambiguous=!!matches&&matches.size>1;
  const exactRegion=matches&&[...matches].find(candidate=>slugify(candidate)===slugify(normalizedRegion));
  if(ambiguous&&!exactRegion)return null;
  const citySlug=ambiguous?`${base}-${slugify(exactRegion)}`:base;
  if(citySlug.length>80)return null;
  return {city:name,countryCode:code,citySlug,region:exactRegion||normalizedRegion||"",path:`/city/${code.toLowerCase()}/${citySlug}`};
}
