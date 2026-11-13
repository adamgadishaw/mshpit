// Geometry regression for the actual mounted Show action styles. No UIKit,
// text rasterization or app navigation is simulated by this executable.
#include <iostream>
#include <string>
#include <yoga/Yoga.h>
#include <yoga/node/Node.h>

using namespace facebook::yoga;

StyleSizeLength length(const std::string& value) {
  return value.ends_with('%') ? StyleSizeLength::percent(std::stof(value))
                             : StyleSizeLength::points(std::stof(value));
}

void commitStyle(Node& node, const Style& style) {
  // RN 0.86.3 YogaLayoutableShadowNode::updateYogaProps uses setDirty/setStyle,
  // not the public Yoga C setters' markDirtyAndPropagate. Those setters clear
  // computedFlexBasis and would conceal the retained native failure.
  if (!node.isDirty() && style != node.style()) node.setDirty(true);
  node.setStyle(style);
}

int main(int argc, char** argv) {
  Config config(nullptr);
  config.setPointScaleFactor(3);
  config.setErrata(Errata::All);
  // RN 0.86.3 defaults this feature flag off. Exercise both settings.
  config.setExperimentalFeatureEnabled(ExperimentalFeature::FixFlexBasisFitContent,
      argc == 2 && std::string(argv[1]) == "--fit-content");
  Node root(&config), row(&config), review(&config), lounge(&config);
  root.insertChild(&row, 0); row.setOwner(&root);
  row.insertChild(&review, 0); review.setOwner(&row);
  row.insertChild(&lounge, 1); lounge.setOwner(&row);
  float width, padding, gap;
  int wrap, rtl;
  // Every line is another commit to the SAME nodes, including reverse changes
  // and viewport rotation. Styles come from the real React component fixture.
  while (std::cin >> width >> padding >> gap >> wrap >> rtl) {
    auto rootStyle = root.style();
    rootStyle.setDimension(Dimension::Width, StyleSizeLength::points(width));
    rootStyle.setPadding(Edge::All, StyleLength::points(padding));
    commitStyle(root, rootStyle);
    auto rowStyle = row.style();
    rowStyle.setFlexDirection(FlexDirection::Row);
    rowStyle.setFlexWrap(wrap ? Wrap::Wrap : Wrap::NoWrap);
    rowStyle.setGap(Gutter::All, StyleLength::points(gap));
    commitStyle(row, rowStyle);
    for (auto* child : {&review, &lounge}) {
      float flex, minHeight;
      std::string basis, minWidth;
      if (!(std::cin >> flex >> basis >> minWidth >> minHeight)) return 2;
      auto style = child->style();
      style.setFlex(FloatOptional(flex));
      style.setFlexBasis(length(basis));
      style.setMinDimension(Dimension::Width, length(minWidth));
      style.setMinDimension(Dimension::Height, StyleSizeLength::points(minHeight));
      commitStyle(*child, style);
    }
    // Fabric clones/marks the changed ancestry. Do not clear children's caches.
    row.setDirty(true); root.setDirty(true);
    YGNodeCalculateLayout(&root, width, YGUndefined, rtl ? YGDirectionRTL : YGDirectionLTR);
    std::cout << YGNodeLayoutGetWidth(&row) << ' ' << YGNodeLayoutGetHeight(&row);
    for (const auto* child : {&review, &lounge}) {
      std::cout << ' ' << YGNodeLayoutGetLeft(child) << ' ' << YGNodeLayoutGetTop(child)
                << ' ' << YGNodeLayoutGetWidth(child) << ' ' << YGNodeLayoutGetHeight(child);
    }
    std::cout << '\n';
  }
  return std::cin.eof() ? 0 : 3;
}
