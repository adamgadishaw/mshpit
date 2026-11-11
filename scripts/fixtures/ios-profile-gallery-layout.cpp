// Native regression for the exact Yoga dependency bundled by React Native.
// The JS runner supplies geometry read from the actual iOS gallery styles.
#include <yoga/Yoga.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>

struct Geometry { float margin, gap, percent, minWidth, minHeight, ratio, artPercent, artRatio; };
YGNodeRef node(YGConfigRef config, YGNodeRef parent = nullptr) {
  auto result = YGNodeNewWithConfig(config);
  if (parent) YGNodeInsertChild(parent, result, YGNodeGetChildCount(parent));
  return result;
}
void fill(YGNodeRef value) {
  YGNodeStyleSetPositionType(value, YGPositionTypeAbsolute);
  for (auto edge : {YGEdgeLeft, YGEdgeRight, YGEdgeTop, YGEdgeBottom}) YGNodeStyleSetPosition(value, edge, 0);
}
void check(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}
bool near(float a, float b) { return std::fabs(a - b) <= 0.51f; }

int run(const Geometry& g, bool legacy, bool video, int count, float scale) {
  auto config = YGConfigNew();
  // Fabric's YogaLayoutableShadowNode uses YGErrataAll by default.
  YGConfigSetErrata(config, YGErrataAll);
  YGConfigSetPointScaleFactor(config, scale);
  auto root = node(config);
  auto row = node(config, root);
  YGNodeStyleSetFlexDirection(row, YGFlexDirectionRow);
  YGNodeStyleSetFlexWrap(row, YGWrapWrap);
  YGNodeStyleSetGap(row, YGGutterAll, g.gap);
  YGNodeStyleSetMargin(row, YGEdgeHorizontal, g.margin);
  std::vector<YGNodeRef> cells, wrappers, images;
  for (int i = 0; i < count; ++i) {
    auto cell = node(config, row);
    YGNodeStyleSetWidthPercent(cell, g.percent);
    YGNodeStyleSetAspectRatio(cell, g.ratio);
    YGNodeStyleSetMinWidth(cell, g.minWidth);
    YGNodeStyleSetMinHeight(cell, g.minHeight);
    YGNodeStyleSetOverflow(cell, YGOverflowHidden);
    auto wrapper = node(config, cell);
    YGNodeStyleSetOverflow(wrapper, YGOverflowHidden);
    if (legacy) fill(wrapper);
    else {
      YGNodeStyleSetWidthPercent(wrapper, g.artPercent);
      YGNodeStyleSetAspectRatio(wrapper, g.artRatio);
    }
    auto image = node(config, wrapper); fill(image);
    if (video) {
      auto badge = node(config, wrapper);
      YGNodeStyleSetPositionType(badge, YGPositionTypeAbsolute);
      YGNodeStyleSetWidth(badge, 36); YGNodeStyleSetHeight(badge, 36);
      YGNodeStyleSetPositionPercent(badge, YGEdgeTop, 50); YGNodeStyleSetPositionPercent(badge, YGEdgeLeft, 50);
      YGNodeStyleSetMargin(badge, YGEdgeTop, -18); YGNodeStyleSetMargin(badge, YGEdgeLeft, -18);
    }
    cells.push_back(cell); wrappers.push_back(wrapper); images.push_back(image);
  }
  int cases = 0;
  // Reuse the same native nodes: catch cached-layout errors on size changes.
  for (float width : {320.f, 393.f, 440.f, 768.f, 393.f, 320.f}) {
    YGNodeStyleSetWidth(root, width);
    YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);
    for (int i = 0; i < count; ++i) {
      const float expected = (width - 2 * g.margin) * g.percent / 100;
      check(near(YGNodeLayoutGetWidth(cells[i]), expected), "Cell width changed");
      check(near(YGNodeLayoutGetHeight(row), expected / g.ratio), "Row height changed");
      if (legacy) check(near(YGNodeLayoutGetHeight(cells[i]), g.minHeight), "Legacy collapse did not reproduce");
      else for (auto value : {cells[i], wrappers[i], images[i]}) {
        check(near(YGNodeLayoutGetWidth(value), expected), "Media width differs from cell");
        check(near(YGNodeLayoutGetHeight(value), expected), "Square cell/media collapsed");
        check(YGNodeLayoutGetWidth(value) >= 44 && YGNodeLayoutGetHeight(value) >= 44, "44pt target lost");
      }
    }
    if (width == 440 && count == 3 && video && scale == 3) std::printf("%s: row %.2f, cell %.2fx%.2f, wrapper %.2fx%.2f, image %.2fx%.2f\n", legacy ? "baseline" : "production", YGNodeLayoutGetHeight(row), YGNodeLayoutGetWidth(cells[0]), YGNodeLayoutGetHeight(cells[0]), YGNodeLayoutGetWidth(wrappers[0]), YGNodeLayoutGetHeight(wrappers[0]), YGNodeLayoutGetWidth(images[0]), YGNodeLayoutGetHeight(images[0]));
    ++cases;
  }
  YGNodeFreeRecursive(root); YGConfigFree(config);
  return cases;
}
int main(int argc, char** argv) {
  check(argc == 9, "Expected eight style geometry values");
  Geometry g{std::stof(argv[1]),std::stof(argv[2]),std::stof(argv[3]),std::stof(argv[4]),std::stof(argv[5]),std::stof(argv[6]),std::stof(argv[7]),std::stof(argv[8])};
  int cases = 0;
  for (float scale : {2.f, 3.f}) for (bool legacy : {true, false}) for (bool video : {true, false}) for (int count : {1, 2, 3}) cases += run(g, legacy, video, count, scale);
  std::printf("Passed %d native Yoga cases: baseline collapse, production photo/video, 1–3 tiles, widths320/393/440/768 at2x/3x and repeated resizing.\n", cases);
}
