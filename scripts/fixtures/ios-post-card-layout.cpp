// Uses the installed React Native Yoga source, with synthetic text measurement.
// The JS runner supplies production styles and the production stacking decision.
#include <yoga/Yoga.h>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
struct Text { float width; float line; };
YGSize measure(YGNodeConstRef n,float w,YGMeasureMode wm,float,YGMeasureMode) {
 auto t=(Text*)YGNodeGetContext(n); float width=wm==YGMeasureModeUndefined?t->width:std::min(w,t->width);
 return {width,t->line*std::max(1.f,std::ceil(t->width/std::max(1.f,width)))};
}
YGNodeRef node(YGConfigRef c,YGNodeRef parent=nullptr) {auto n=YGNodeNewWithConfig(c);if(parent)YGNodeInsertChild(parent,n,YGNodeGetChildCount(parent));return n;}
void check(bool ok,const char* what){if(!ok){fprintf(stderr,"%s\n",what);exit(1);}}
int main(int argc,char**argv){float pad=atof(argv[1]),gap=atof(argv[2]),stackgap=atof(argv[3]),size=atof(argv[4]),line=atof(argv[5]),scoremin=atof(argv[6]);int cases=0;
 for(int i=7;i+3<argc;i+=4){
  const float width=atof(argv[i]), scale=atof(argv[i+1]), length=atof(argv[i+2]);
  const bool stack=atoi(argv[i+3])!=0;
  auto c=YGConfigNew();YGConfigSetErrata(c,YGErrataAll);YGConfigSetPointScaleFactor(c,3);auto root=node(c);YGNodeStyleSetWidth(root,width-24);YGNodeStyleSetPadding(root,YGEdgeAll,pad);YGNodeStyleSetBorder(root,YGEdgeAll,1);
  auto row=node(c,root);
  YGNodeStyleSetFlexDirection(row,stack?YGFlexDirectionColumn:YGFlexDirectionRow);YGNodeStyleSetAlignItems(row,YGAlignFlexStart);YGNodeStyleSetGap(row,YGGutterAll,stack?stackgap:gap);
  auto identity=node(c,row);YGNodeStyleSetFlex(identity,stack?0:1);YGNodeStyleSetMinWidth(identity,0);if(stack)YGNodeStyleSetAlignSelf(identity,YGAlignStretch);
  auto title=node(c,identity);Text text{length*size*.53f*scale,line*scale};YGNodeSetContext(title,&text);YGNodeSetMeasureFunc(title,measure);
  auto score=node(c,row);YGNodeStyleSetMinWidth(score,44);YGNodeStyleSetMinHeight(score,scoremin);YGNodeStyleSetWidth(score,50+25*scale);YGNodeStyleSetHeight(score,std::max(scoremin,20*scale));YGNodeStyleSetMargin(score,YGEdgeTop,stack?0:-6);
  YGNodeCalculateLayout(root,YGUndefined,YGUndefined,YGDirectionLTR);
  float rw=YGNodeLayoutGetWidth(row),rh=YGNodeLayoutGetHeight(row),tw=YGNodeLayoutGetWidth(title),th=YGNodeLayoutGetHeight(title),sx=YGNodeLayoutGetLeft(score),sy=YGNodeLayoutGetTop(score);
  check(tw>0&&th>=line*scale-.1f,"Title collapsed");check(sx+YGNodeLayoutGetWidth(score)<=rw+.51f,"Score clips outside card");check(sy+YGNodeLayoutGetHeight(score)<=rh+.51f,"Score clips below context");
  check(YGNodeLayoutGetWidth(score)>=43.99f&&YGNodeLayoutGetHeight(score)>=43.99f,"Score target smaller than44");
  if(stack)check(sy>=th+stackgap-.51f,"Large text overlaps score");else check(sx>=tw+gap-.51f,"Title overlaps score");
  YGNodeFreeRecursive(root);YGConfigFree(c);cases++;
 }printf("%d exact-Yoga geometry cases passed (synthetic text measurements, not native glyph metrics).\n",cases);
}