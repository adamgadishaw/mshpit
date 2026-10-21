import { useEffect, useMemo, useRef, useState } from "react";
import { createCatalogueMapResolver } from "../../domain/catalogueMapCoordinates.mjs";
import { ensureVenueMapCardStyle, mountVenueMap } from "../../lib/mapLibreVenueMap.web";

const EMPTY = Object.freeze([]);
export default function MapLibreVenueMap({ venues = [], selected, onSelect, city, onMapLocations, trustedCatalogueRows = EMPTY, providerEvents = EMPTY, providerFetchedAt }) {
  const host = useRef(null), engine = useRef(null), select = useRef(onSelect);
  const [state,setState] = useState("loading"), [attempt,setAttempt] = useState(0);
  const resolve = useMemo(() => createCatalogueMapResolver(trustedCatalogueRows, { providerEvents, providerFetchedAt }), [trustedCatalogueRows, providerEvents, providerFetchedAt]);
  const points = useMemo(() => venues.flatMap((row, index) => { const point = resolve(row); return point ? [{ ...point, mapNumber: index + 1 }] : []; }), [venues, resolve]);
  const latest=useRef({points,selected}); latest.current={points,selected}; select.current=onSelect;
  const active=points.find(row=>row.id===selected) || (!selected?points[0]:null);
  const selectedRow=venues.find(row=>row.id===selected) || active;
  useEffect(()=>{onMapLocations?.(points.map(row=>row.id));},[points,onMapLocations]);
  useEffect(()=>{
    ensureVenueMapCardStyle();
    if (!points.length) { setState("empty"); return; }
    const controller=new AbortController();
    let disposed=false, failed=false;
    const fail=()=>{ if(disposed||failed)return; failed=true; controller.abort(); setState("error"); queueMicrotask(()=>{engine.current?.dispose();engine.current=null;}); };
    const deadline=setTimeout(fail,16000);
    setState("loading");
    mountVenueMap(host.current,{signal:controller.signal,onSelect:id=>select.current?.(id),onReady:()=>{if(!disposed&&!failed){clearTimeout(deadline);setState("ready");}},onFail:fail})
      .then(value=>{if(disposed||failed){value?.dispose();return;}engine.current=value;value?.update(latest.current.points,latest.current.selected);})
      .catch(()=>{if(!controller.signal.aborted)fail();});
    return()=>{disposed=true;clearTimeout(deadline);controller.abort();engine.current?.dispose();engine.current=null;};
  },[city,attempt,points.length>0]);
  useEffect(()=>{engine.current?.update(points,selected);},[points,selected]);
  return <section className="mshpit-maplibre" data-map-state={state} aria-label={`Venue locations in ${city}`}>
    <div className="map-stage">
      <div ref={host} className="map-host" role="region" aria-label={`Interactive street map of ${city}`} />
      <div className="map-heading"><span className="map-city">{String(city||"VENUES").toUpperCase()}<span>Venue map</span></span><button className="fit-button" type="button" aria-label="Fit all mapped venue locations" disabled={state!=="ready"} onClick={()=>engine.current?.fit()}>⌖ <span>All venues</span></button></div>
      {state==="loading"&&<div className="loading-note" role="status">Loading map…</div>}
      {(state==="error"||state==="empty")&&<div className="map-fallback"><span className="fallback-symbol">⌖</span><h2>{state==="empty"?"No map locations available.":"The map couldn’t load."}</h2><p>Browse venues below.</p>{state==="error"&&<button className="retry" type="button" onClick={()=>setAttempt(value=>value+1)}>Try map again</button>}</div>}
    </div>
    {selectedRow&&<div className="selection" aria-live="polite"><span className="selection-number">{venues.findIndex(row=>row.id===selectedRow.id)+1}</span><div className="selection-main"><div className="selection-kicker">{selected?"SELECTED VENUE":"VENUE LOCATION"}</div><h2>{selectedRow.name}</h2><p>{selectedRow.place || city}</p></div></div>}
  </section>;
}
