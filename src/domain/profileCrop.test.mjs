import assert from 'node:assert/strict';
import test from 'node:test';
import { profileCropPlan, profileCropAfterDrag } from './profileCrop.mjs';

for (const [imageWidth,imageHeight] of [[1800,1200],[1200,1800],[12000,120],[120,12000],[100,100]]) {
  for (const [frameWidth,frameHeight] of [[300,300],[900,300]]) {
    test(`crop covers ${frameWidth}:${frameHeight} with ${imageWidth}x${imageHeight} and edge drags`,()=>{
      for (const zoom of [1,1.5,4,99]) for (const centerX of [-10,0,0.5,1,10]) for (const centerY of [-10,0.5,10]) {
        const p=profileCropPlan({imageWidth,imageHeight,frameWidth,frameHeight,zoom,centerX,centerY});
        assert.ok(p.left<=0.000001&&p.top<=0.000001);
        assert.ok(p.left+p.renderedWidth>=frameWidth-0.000001&&p.top+p.renderedHeight>=frameHeight-0.000001);
        assert.ok(p.x>=0&&p.y>=0&&p.x+p.width<=imageWidth+0.000001&&p.y+p.height<=imageHeight+0.000001);
        assert.ok(Math.abs(p.width/p.height-frameWidth/frameHeight)<0.000001);
        assert.ok(p.zoom>=1&&p.zoom<=4);
      }
    });
  }
}
test('drag moves the image with the pointer and normalizes against the source',()=>{
  const options={imageWidth:1000,imageHeight:1000,frameWidth:300,frameHeight:300,zoom:2};
  const p=profileCropPlan(options), next=profileCropPlan({...options,...profileCropAfterDrag(p,{deltaX:60,deltaY:-30,imageWidth:1000,imageHeight:1000})});
  assert.equal(next.left-p.left,60);assert.equal(next.top-p.top,-30);
});
test('invalid dimensions fail before rendering and invalid controls reset safely',()=>{
  assert.throws(()=>profileCropPlan({imageWidth:0,imageHeight:10,frameWidth:10,frameHeight:10}),/dimensions/);
  const p=profileCropPlan({imageWidth:100,imageHeight:100,frameWidth:50,frameHeight:50,zoom:NaN,centerX:Infinity});
  assert.equal(p.zoom,1);assert.equal(p.centerX,0.5);
});
