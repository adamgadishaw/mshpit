// Installed RN Yoga, retained nodes and real component styles. Text metrics
// are explicit conservative test inputs, NOT UIKit/CoreText measurements.
#include <algorithm>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include <yoga/Yoga.h>
#include <yoga/node/Node.h>
using namespace facebook::yoga;

struct Entry { std::unique_ptr<Node> node; int parent; float textWidth=0, lineHeight=0; };
StyleSizeLength length(const std::string& value) {
  if (value=="_") return StyleSizeLength::undefined();
  if (value=="auto") return StyleSizeLength::ofAuto();
  return value.ends_with('%') ? StyleSizeLength::percent(std::stof(value)) : StyleSizeLength::points(std::stof(value));
}
YGSize measure(YGNodeConstRef node, float width, YGMeasureMode mode, float height, YGMeasureMode heightMode) {
  const auto& e = *static_cast<const Entry*>(YGNodeGetContext(node));
  const float used = mode==YGMeasureModeExactly ? width : mode==YGMeasureModeAtMost ? std::min(e.textWidth,width) : e.textWidth;
  const float lines = std::max(1.0f,std::ceil(e.textWidth/std::max(used,1.0f)));
  const float measuredHeight = lines*e.lineHeight;
  return {used,heightMode==YGMeasureModeExactly?height:heightMode==YGMeasureModeAtMost?std::min(height,measuredHeight):measuredHeight};
}
int main(int argc,char** argv) {
  Config config(nullptr); config.setPointScaleFactor(3); config.setErrata(Errata::All);
  config.setExperimentalFeatureEnabled(ExperimentalFeature::FixFlexBasisFitContent,argc==2&&std::string(argv[1])=="--fit-content");
  std::vector<std::unique_ptr<Entry>> entries;
  int count,rtl; float viewport;
  while(std::cin>>count>>viewport>>rtl) {
    if(entries.empty()) for(int i=0;i<count;i++) {
      auto e=std::make_unique<Entry>(); e->node=std::make_unique<Node>(&config); e->node->setContext(e.get()); entries.push_back(std::move(e));
    }
    if(count!=entries.size()) return 2;
    for(int i=0;i<count;i++) {
      int parent,row,wrap,align,justify; float gap,padH,padV,minHeight,textWidth,lineHeight;
      std::string flex,grow,shrink,basis,minWidth,width,height;
      if(!(std::cin>>parent>>row>>wrap>>gap>>flex>>grow>>shrink>>basis>>minWidth>>width>>height>>padH>>padV>>minHeight>>align>>justify>>textWidth>>lineHeight)) return 3;
      auto& e=*entries[i]; e.parent=parent; e.textWidth=textWidth; e.lineHeight=lineHeight;
      if(parent>=0 && !e.node->getOwner()) { auto& owner=*entries[parent]->node; owner.insertChild(e.node.get(),owner.getChildCount()); e.node->setOwner(&owner); }
      if(textWidth>0 && !e.node->hasMeasureFunc()) e.node->setMeasureFunc(measure);
      Style s; s.setFlexDirection(row?FlexDirection::Row:FlexDirection::Column); s.setFlexWrap(wrap?Wrap::Wrap:Wrap::NoWrap);
      s.setGap(Gutter::All,StyleLength::points(gap));
      if(flex!="_") s.setFlex(FloatOptional(std::stof(flex)));
      if(grow!="_") s.setFlexGrow(FloatOptional(std::stof(grow)));
      if(shrink!="_") s.setFlexShrink(FloatOptional(std::stof(shrink)));
      if(basis!="_") s.setFlexBasis(length(basis));
      s.setMinDimension(Dimension::Width,length(minWidth));
      s.setDimension(Dimension::Width,i==0?StyleSizeLength::points(viewport):length(width));
      s.setDimension(Dimension::Height,length(height));
      s.setMinDimension(Dimension::Height,StyleSizeLength::points(minHeight));
      s.setPadding(Edge::Horizontal,StyleLength::points(padH)); s.setPadding(Edge::Vertical,StyleLength::points(padV));
      s.setAlignItems(align==1?Align::Center:align==2?Align::Baseline:align==3?Align::FlexStart:Align::Stretch);
      s.setJustifyContent(justify==1?Justify::Center:justify==2?Justify::SpaceBetween:Justify::FlexStart);
      // Mirror Fabric's dirty/style commit, retaining computed native caches.
      e.node->setDirty(true); e.node->setStyle(s);
    }
    YGNodeCalculateLayout(entries[0]->node.get(),viewport,YGUndefined,rtl?YGDirectionRTL:YGDirectionLTR);
    std::vector<float> xs(count),ys(count);
    for(int i=0;i<count;i++) {
      const auto& e=*entries[i]; xs[i]=YGNodeLayoutGetLeft(e.node.get())+(e.parent<0?0:xs[e.parent]); ys[i]=YGNodeLayoutGetTop(e.node.get())+(e.parent<0?0:ys[e.parent]);
      if(i) std::cout<<' ';
      std::cout<<xs[i]<<' '<<ys[i]<<' '<<YGNodeLayoutGetWidth(e.node.get())<<' '<<YGNodeLayoutGetHeight(e.node.get());
    }
    std::cout<<'\n';
  }
  return std::cin.eof()?0:4;
}
