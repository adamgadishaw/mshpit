import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
const files = [['../components/PostMediaGrid.jsx','fill'],['../components/ClipPoster.jsx','cover'],['../components/media-player/MshpitVideoPlayer.jsx','videoStatus'],['../features/festivals/FestivalBackdrop.jsx','fill'],['../features/festivals/FestivalCard.jsx','shade'],['../features/festivals/FestivalScreen.jsx','heroShade']];
const fill={position:'absolute',top:0,right:0,bottom:0,left:0};
function styles(file,StyleSheet){const source=readFileSync(new URL(file,import.meta.url),'utf8');const ast=parse(source,{sourceType:'module',plugins:['jsx']});const declarations=ast.program.body.filter(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>['absoluteFill','styles'].includes(d.id.name))).map(n=>source.slice(n.start,n.end)).join('\n');return new Function('StyleSheet','colors','radius','mono','space','font','displayFont','loop','Platform',declarations+';return styles;')(StyleSheet,{}, {},'mono',n=>n*4,'font','display',()=>({}),{OS:'android',select:choices=>choices.default||{}});}
test('RN 0.86 media tiles and overlays remain bounded without the removed alias',()=>{for(const [file,key]of files){const result=styles(file,{absoluteFill:fill,create:v=>v})[key];for(const [k,v]of Object.entries(fill))assert.equal(result[k],v,file+':'+k);}});
test('existing web absolute-fill values remain preferred',()=>{for(const [file,key]of files){const result=styles(file,{absoluteFill:{position:'relative'},absoluteFillObject:fill,create:v=>v})[key];for(const [k,v]of Object.entries(fill))assert.equal(result[k],v,file+':'+k);}});
