import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
export const textOf = node => node.text ?? (node.children || []).map(textOf).join('');
export const styleOf = node => Object.assign({},...[node.props?.style].flat(Infinity).filter(Boolean));
export function snapshot(node,width,scale,rtl=false,glyph=0.6) {
  const entries=[];
  function walk(node,parent) {
    const style=styleOf(node), label=textOf(node), isText=node.type==='Text';
    if(style.display==='none') return;
    const font=(style.fontSize??14)*scale;
    const unit=font*glyph+(style.letterSpacing??0)*scale;
    const metric=isText?Array.from(label).length*unit:0;
    const i=entries.length;
    entries.push({node,parent,style,label,isText,metric,longestWord:isText?Math.max(0,...label.split(/\s+/u).map(word=>Array.from(word).length*unit)):0,
      lineHeight:(style.lineHeight??(style.fontSize??14)*1.25)*scale});
    if(isText) return;
    if(node.type==='Icon'||node.type==='Stars') { entries[i].style={...style,width:node.props.size??16,height:node.props.size??16}; return; }
    for(const child of node.children||[]) if(child.type) walk(child,i);
  }
  walk(node,-1); return {width,scale,rtl,entries};
}
export function geometry(frames) {
  const value=x=>x??'_';
  const input=frames.map(frame=>`${frame.entries.length} ${frame.width} ${+frame.rtl}\n`+frame.entries.map(e=>{
    const s=e.style; return [e.parent,+(s.flexDirection==='row'),+(s.flexWrap==='wrap'),s.gap??0,value(s.flex),value(s.flexGrow),value(s.flexShrink),value(s.flexBasis),value(s.minWidth),value(s.width),value(s.height),s.paddingHorizontal??s.padding??0,s.paddingVertical??s.padding??0,s.minHeight??0,
      ({center:1,baseline:2,'flex-start':3})[s.alignItems]??0,({center:1,'space-between':2})[s.justifyContent]??0,e.metric,e.lineHeight].join(' ');
  }).join('\n')).join('\n')+'\n';
  const run=args=>spawnSync(process.env.PIT_TEXT_YOGA_PROBE,args,{input,encoding:'utf8',timeout:10000});
  const result=run([]),other=run(['--fit-content']);
  for(const r of [result,other]) { assert.ifError(r.error); assert.equal(r.status,0,r.stderr); }
  assert.equal(other.stdout,result.stdout,'fit-content feature flag parity');
  return result.stdout.trim().split(/\r?\n/).map((line,index)=>{
    const values=line.split(' ').map(Number); assert.equal(values.length,frames[index].entries.length*4);
    return frames[index].entries.map((entry,i)=>({...entry,x:values[i*4],y:values[i*4+1],width:values[i*4+2],height:values[i*4+3]}));
  });
}
export function assertReadable(frame,bounds) {
  for(const e of bounds) {
    assert.ok(e.x>=-0.5&&e.x+e.width<=frame.width+0.5,`${e.label}: outside ${frame.width} at scale ${frame.scale}: x=${e.x} width=${e.width}`);
    if(!e.isText||!e.label) continue;
    if(/^\d\.\d$/.test(e.label)) assert.ok(e.width+0.5>=e.metric,`complete score ${e.label}: ${e.width} < ${e.metric}`);
    else assert.ok(e.width+0.5>=Math.min(e.longestWord,frame.width),`word fragmented in ${e.label}: ${e.width} < ${e.longestWord}`);
    assert.ok(e.height+0.5>=e.lineHeight,`${e.label}: line height clipped`);
  }
}
