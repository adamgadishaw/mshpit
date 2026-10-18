import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colors } from "../theme";
import { profileCropAfterDrag, profileCropPlan } from "../domain/profileCrop.mjs";
import { MEDIA_PHOTO_SOURCE_MAX_BYTES, mediaUploadLimitLabel } from "../domain/mediaUploadPolicy.mjs";

const CENTER = Object.freeze({ zoom: 1, centerX: 0.5, centerY: 0.5 });
const pointerCenter = points => ({ x: points.reduce((v,p)=>v+p.x,0)/points.length, y: points.reduce((v,p)=>v+p.y,0)/points.length });
const pointerDistance = points => points.length < 2 ? 0 : Math.hypot(points[0].x-points[1].x, points[0].y-points[1].y);

export default function ProfileImageCropDialog({ asset, purpose, signal, upload, onFinish }) {
  const avatar = purpose === "avatar";
  const title = avatar ? "Adjust profile photo" : "Adjust banner";
  const hintId = useId(), titleId = useId();
  const frame = useRef(null), panel = useRef(null), activeUpload = useRef(null);
  const pointers = useRef(new Map()), previousGesture = useRef(null), gesture = useRef(CENTER);
  const [position, setPosition] = useState(CENTER), [source, setSource] = useState(null);
  const [dimensions, setDimensions] = useState(null), [frameSize, setFrameSize] = useState({width:1,height:1});
  const [previewError, setPreviewError] = useState(""), [uploadError, setUploadError] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceIssue = Number(asset?.file?.size ?? asset?.fileSize) > MEDIA_PHOTO_SOURCE_MAX_BYTES
    ? { message:`That photo is over the ${mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES)} upload limit. Choose a smaller copy before uploading it.` }
    : null;
  const setCrop = value => { gesture.current = value; setPosition(value); };
  const plan = dimensions ? profileCropPlan({imageWidth:dimensions.width,imageHeight:dimensions.height,frameWidth:frameSize.width,frameHeight:frameSize.height,...position}) : null;
  const planRef = useRef(plan); planRef.current = plan;
  const cancel = () => { activeUpload.current?.abort(); onFinish(null); };

  useEffect(() => {
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      activeUpload.current?.abort();
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, []);
  useEffect(() => {
    if (sourceIssue) return undefined;
    if (typeof createImageBitmap !== "function") { setPreviewError("This browser cannot preview this photo. You can upload it without adjustments."); return undefined; }
    const owned = asset?.file instanceof Blob;
    const uri = owned ? URL.createObjectURL(asset.file) : asset?.uri;
    if (!uri) { setPreviewError("This photo could not be opened. Choose another image."); return undefined; }
    setSource(uri);
    return () => { if (owned) URL.revokeObjectURL(uri); };
  }, [asset, !!sourceIssue]);
  useEffect(() => {
    if (!frame.current) return undefined;
    const update = () => { const rect=frame.current?.getBoundingClientRect(); if(rect?.width&&rect?.height)setFrameSize({width:rect.width,height:rect.height}); };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(frame.current); window.addEventListener("resize",update);
    return () => { observer?.disconnect(); window.removeEventListener("resize",update); };
  }, []);

  const apply = async original => {
    if (activeUpload.current || sourceIssue || signal?.aborted || (!original && !planRef.current)) return;
    const controller = new AbortController(); activeUpload.current = controller;
    const abort = () => controller.abort(); signal?.addEventListener("abort",abort,{once:true});
    setBusy(true); setUploadError("");
    try {
      const selected = original ? asset : { ...asset, profileCrop: planRef.current.selection };
      const result = await upload(selected, { signal:controller.signal });
      if (!controller.signal.aborted && !signal?.aborted) onFinish(result);
    } catch {
      if (!controller.signal.aborted && !signal?.aborted) {
        setUploadError("Your photo could not be uploaded. Your crop is still here; try again or choose Cancel to keep the old photo.");
      }
    } finally {
      signal?.removeEventListener("abort",abort);
      if (activeUpload.current === controller) { activeUpload.current = null; if(!controller.signal.aborted&&!signal?.aborted)setBusy(false); }
    }
  };

  const pointerDown = event => {
    if (!planRef.current || busy || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault(); frame.current.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const values=[...pointers.current.values()];previousGesture.current={center:pointerCenter(values),distance:pointerDistance(values)};
  };
  const pointerMove = event => {
    if (!pointers.current.has(event.pointerId) || !planRef.current || busy) return;
    event.preventDefault(); pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const values=[...pointers.current.values()],center=pointerCenter(values),distance=pointerDistance(values),previous=previousGesture.current;
    const activePlan=profileCropPlan({imageWidth:dimensions.width,imageHeight:dimensions.height,frameWidth:frameSize.width,frameHeight:frameSize.height,...gesture.current});
    let next=profileCropAfterDrag(activePlan,{deltaX:center.x-previous.center.x,deltaY:center.y-previous.center.y,imageWidth:dimensions.width,imageHeight:dimensions.height});
    if (distance>0&&previous.distance>0)next.zoom=Math.max(1,Math.min(4,next.zoom*distance/previous.distance));
    const bounded=profileCropPlan({imageWidth:dimensions.width,imageHeight:dimensions.height,frameWidth:frameSize.width,frameHeight:frameSize.height,...next});
    setCrop({zoom:bounded.zoom,centerX:bounded.centerX,centerY:bounded.centerY});
    previousGesture.current={center,distance};
  };
  const pointerUp = event => {
    pointers.current.delete(event.pointerId);
    const values=[...pointers.current.values()];previousGesture.current=values.length?{center:pointerCenter(values),distance:pointerDistance(values)}:null;
  };
  const keyDown = event => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
    if (event.key === "Tab") {
      const controls=[...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };
  const moveByKey = event => {
    const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[event.key];
    if(!delta||!planRef.current||busy)return;event.preventDefault();
    const next=profileCropAfterDrag(planRef.current,{deltaX:delta[0],deltaY:delta[1],imageWidth:dimensions.width,imageHeight:dimensions.height});
    const bounded=profileCropPlan({imageWidth:dimensions.width,imageHeight:dimensions.height,frameWidth:frameSize.width,frameHeight:frameSize.height,...next});
    setCrop({zoom:bounded.zoom,centerX:bounded.centerX,centerY:bounded.centerY});
  };
  return createPortal(<div style={styles.overlay} onKeyDown={keyDown}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={styles.panel} data-testid="profile-crop-dialog">
      <header style={styles.header}><h2 id={titleId} style={styles.title}>{title}</h2><button type="button" onClick={cancel} style={styles.close} aria-label="Cancel photo adjustment">×</button></header>
      <p id={hintId} style={styles.hint}>Drag to reposition. Pinch or use the slider to zoom. Arrow keys nudge the photo.</p>
      {sourceIssue ? <p role="alert" style={styles.error}>{sourceIssue.message}</p> : <>
        <div ref={frame} data-testid="profile-crop-frame" role="group" aria-label="Photo crop preview" aria-describedby={hintId} tabIndex={0}
          onKeyDown={moveByKey} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
          style={{...styles.frame,aspectRatio:avatar?'1 / 1':'3 / 1',maxWidth:avatar?320:'100%',borderRadius:avatar?'50%':12,cursor:busy?'progress':'grab'}}>
          {source&&!previewError ? <img src={source} alt="" draggable={false} aria-hidden="true"
            onLoad={event=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}
            onError={()=>setPreviewError("This browser cannot preview this photo. You can upload it without adjustments.")}
            style={{position:'absolute',maxWidth:'none',userSelect:'none',pointerEvents:'none',visibility:plan?'visible':'hidden',left:plan?.left||0,top:plan?.top||0,width:plan?.renderedWidth||1,height:plan?.renderedHeight||1}} /> : null}
          {plan&&!previewError ? <div aria-hidden="true" style={styles.grid}>{[1,2].map(i=><span key={i} style={{position:'absolute',left:`${i*100/3}%`,top:0,bottom:0,borderLeft:'1px solid rgba(255,255,255,0.25)'}}/>)}{[1,2].map(i=><span key={i} style={{position:'absolute',top:`${i*100/3}%`,left:0,right:0,borderTop:'1px solid rgba(255,255,255,0.25)'}}/>)}</div> : null}
        </div>
        {previewError ? <p role="status" style={styles.hint}>{previewError}</p> : <label style={styles.zoom}>Zoom <input type="range" aria-label="Photo zoom" min="1" max="4" step="0.01" value={position.zoom} disabled={busy||!plan}
          onChange={event=>setCrop({...gesture.current,zoom:Number(event.target.value)})} style={{flex:1,minWidth:0,accentColor:colors.amber}}/><output aria-live="off" style={{minWidth:44,textAlign:'right'}}>{Math.round(position.zoom*100)}%</output></label>}
        {!avatar ? <p style={styles.note}>Keep the subject near the center; banners adapt to screen size.</p> : null}
        <button type="button" disabled={busy||!plan||!!previewError} onClick={()=>setCrop(CENTER)} style={styles.reset}>Reset position</button>
      </>}
      {uploadError ? <p role="alert" data-testid="profile-crop-upload-error" style={styles.error}>{uploadError}</p> : null}
      <footer style={styles.footer}><button type="button" onClick={cancel} style={styles.secondary}>Cancel</button>
        <button type="button" onClick={()=>apply(!!previewError)} disabled={busy||!!sourceIssue||(!plan&&!previewError)} style={{...styles.primary,opacity:busy||sourceIssue||(!plan&&!previewError)?0.5:1}}>
          {busy?'Uploading…':previewError?'Use original photo':'Use photo'}</button></footer>
    </section>
  </div>,document.body);
}

const styles={
  overlay:{position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,0.65)',display:'flex',alignItems:'center',justifyContent:'center',padding:16},
  panel:{boxSizing:'border-box',width:'100%',maxWidth:600,maxHeight:'calc(100dvh - 32px)',overflowY:'auto',background:colors.surface,color:colors.text,border:`1px solid ${colors.line}`,borderRadius:20,padding:20,fontFamily:'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',outline:'none'},
  header:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},title:{fontSize:20,lineHeight:'28px',margin:0},
  close:{border:0,color:colors.text,background:'transparent',fontSize:28,minWidth:44,minHeight:44,cursor:'pointer'},
  hint:{fontSize:14,lineHeight:'21px',color:colors.textDim,margin:'8px 0 16px'},
  frame:{boxSizing:'border-box',position:'relative',width:'100%',margin:'0 auto',overflow:'hidden',background:colors.bg,touchAction:'none',outline:`1px solid ${colors.line}`},
  grid:{position:'absolute',inset:0,pointerEvents:'none'},zoom:{display:'flex',alignItems:'center',gap:12,fontSize:14,marginTop:20,minHeight:44},
  note:{fontSize:12,lineHeight:'18px',color:colors.textDim,margin:'8px 0'},
  reset:{background:'transparent',border:0,color:colors.amber,fontSize:13,fontWeight:700,minHeight:44,cursor:'pointer'},
  error:{fontSize:14,lineHeight:'21px',color:colors.danger,margin:'12px 0'},footer:{display:'flex',justifyContent:'flex-end',gap:12,marginTop:12},
  secondary:{minHeight:44,padding:'10px 20px',borderRadius:24,border:`1px solid ${colors.line}`,color:colors.text,background:'transparent',fontWeight:700,cursor:'pointer'},
  primary:{minHeight:44,padding:'10px 24px',borderRadius:24,border:0,color:'#1A1206',background:colors.amberStrong,fontWeight:800,cursor:'pointer'},
};
