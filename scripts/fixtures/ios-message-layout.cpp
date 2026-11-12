// Real Yoga geometry; synthetic text sizes deliberately do not certify glyphs.
// The runner extracts style constants and composer cap from ThreadScreen.jsx.
#include <yoga/Yoga.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "message-layout-style.h"

struct Text { float width, line; };
static float currentWidth, currentScale, currentLength, currentExtra;
static const char* currentKind;
static constexpr float tolerance = .51f;
void check(bool ok, const char* reason) {
  if (!ok) {
    fprintf(stderr, "%s: %s width=%g scale=%g length=%g variant=%g\n", currentKind, reason, currentWidth, currentScale, currentLength, currentExtra);
    exit(1);
  }
}
YGSize measure(YGNodeConstRef n, float width, YGMeasureMode mode, float, YGMeasureMode) {
  const auto text = static_cast<Text*>(YGNodeGetContext(n));
  const float measured = mode == YGMeasureModeUndefined ? text->width : std::min(std::max(1.f, width), text->width);
  return { measured, text->line * std::max(1.f, std::ceil(text->width / std::max(1.f, measured))) };
}
YGNodeRef node(YGConfigRef config, YGNodeRef parent = nullptr) {
  auto result = YGNodeNewWithConfig(config);
  if (parent) YGNodeInsertChild(parent, result, YGNodeGetChildCount(parent));
  return result;
}
YGNodeRef textNode(YGConfigRef config, YGNodeRef parent, Text& text) {
  auto result = node(config, parent); YGNodeSetContext(result, &text); YGNodeSetMeasureFunc(result, measure); return result;
}
float width(YGNodeRef n) { return YGNodeLayoutGetWidth(n); }
float height(YGNodeRef n) { return YGNodeLayoutGetHeight(n); }
float left(YGNodeRef n) { return YGNodeLayoutGetLeft(n); }
float top(YGNodeRef n) { return YGNodeLayoutGetTop(n); }
void contained(YGNodeRef parent, YGNodeRef child) {
  check(std::isfinite(width(child)) && std::isfinite(height(child)), "non-finite bounds");
  check(left(child) >= -tolerance && top(child) >= -tolerance, "child starts outside parent");
  check(left(child) + width(child) <= width(parent) + tolerance, "child extends outside parent width");
  check(top(child) + height(child) <= height(parent) + tolerance, "child extends outside parent height");
}
void bubbleCase(YGConfigRef config, float screenWidth, float scale, float length, int kind) {
  const bool incoming = kind == 0 || kind == 3, failed = kind == 2, canReport = kind == 0;
  auto root = node(config); YGNodeStyleSetWidth(root, screenWidth - chatPadding * 2);
  auto row = node(config, root); YGNodeStyleSetFlexDirection(row, YGFlexDirectionRow);
  YGNodeStyleSetAlignItems(row, YGAlignFlexStart); YGNodeStyleSetGap(row, YGGutterAll, rowGap);
  if (!incoming) YGNodeStyleSetJustifyContent(row, YGJustifyFlexEnd);
  YGNodeRef avatar = nullptr;
  if (incoming) {
    avatar = node(config, row); YGNodeStyleSetWidth(avatar, avatarSize); YGNodeStyleSetHeight(avatar, avatarSize + avatarTop);
  }
  auto column = node(config, row); YGNodeStyleSetMinWidth(column, 0); YGNodeStyleSetMaxWidthPercent(column, columnMax);
  YGNodeStyleSetFlexShrink(column, 1); YGNodeStyleSetAlignItems(column, incoming ? YGAlignFlexStart : YGAlignFlexEnd);
  auto bubble = node(config, column); YGNodeStyleSetMaxWidthPercent(bubble, bubbleMax);
  YGNodeStyleSetPadding(bubble, YGEdgeHorizontal, bubblePadX); YGNodeStyleSetPadding(bubble, YGEdgeVertical, bubblePadY);
  const float border = failed ? failedBorder : bubbleBorder;
  YGNodeStyleSetBorder(bubble, YGEdgeAll, border);
  Text message { length * textFont * .53f * scale, textLine * scale }; auto content = textNode(config, bubble, message);
  auto footer = node(config, column); YGNodeStyleSetFlexDirection(footer, YGFlexDirectionRow);
  YGNodeStyleSetAlignItems(footer, YGAlignCenter); YGNodeStyleSetJustifyContent(footer, YGJustifyFlexEnd);
  YGNodeStyleSetFlexWrap(footer, YGWrapWrap); YGNodeStyleSetMaxWidthPercent(footer, footerMax);
  YGNodeStyleSetMinHeight(footer, footerMin); YGNodeStyleSetMargin(footer, YGEdgeTop, footerTop); YGNodeStyleSetGap(footer, YGGutterAll, footerGap);
  Text stamp { 3 * timestampFont * .6f * scale, timestampFont * 1.2f * scale }; auto timestamp = textNode(config, footer, stamp);
  std::vector<YGNodeRef> buttons;
  YGNodeRef actions = nullptr, failureLabel = nullptr;
  Text failure { 8 * failureFont * .6f * scale, failureFont * 1.2f * scale };
  Text retryText { 5 * actionFont * .53f * scale, actionFont * 1.2f * scale }, cancelText { 6 * actionFont * .53f * scale, actionFont * 1.2f * scale };
  YGNodeRef report = nullptr;
  if (canReport) {
    report = node(config, row); YGNodeStyleSetMinWidth(report, reportMinW); YGNodeStyleSetMinHeight(report, reportMinH);
  }
  if (failed) {
    actions = node(config, footer); YGNodeStyleSetFlexDirection(actions, YGFlexDirectionRow); YGNodeStyleSetFlexWrap(actions, YGWrapWrap);
    YGNodeStyleSetFlexShrink(actions, 1); YGNodeStyleSetAlignItems(actions, YGAlignCenter); YGNodeStyleSetGap(actions, YGGutterAll, actionGap);
    failureLabel = textNode(config, actions, failure);
    for (auto text : { &retryText, &cancelText }) {
      auto button = node(config, actions); YGNodeStyleSetMinWidth(button, actionMinW); YGNodeStyleSetMinHeight(button, actionMinH);
      YGNodeStyleSetAlignItems(button, YGAlignCenter); YGNodeStyleSetJustifyContent(button, YGJustifyCenter);
      textNode(config, button, *text); buttons.push_back(button);
    }
  }
  YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);
  contained(root, row); contained(row, column); contained(column, bubble); contained(bubble, content); contained(column, footer); contained(footer, timestamp);
  check(width(column) <= width(row) * columnMax / 100.f + tolerance, "message exceeds production width cap");
  check(width(bubble) > bubblePadX * 2 && height(content) >= message.line - tolerance, "message text collapsed");
  check(top(footer) >= top(bubble) + height(bubble) + footerTop - tolerance, "footer overlaps painted bubble");
  if (avatar) { contained(row, avatar); check(left(column) >= left(avatar) + width(avatar) + rowGap - tolerance, "photo overlaps bubble"); }
  if (report) {
    contained(row, report);
    check(left(report) >= left(column) + width(column) + rowGap - tolerance, "report action overlaps message");
    check(width(report) >= 44 - tolerance && height(report) >= 44 - tolerance, "report target shrank below 44 points");
  }
  if (actions) { contained(footer, actions); contained(actions, failureLabel); }
  for (auto button : buttons) {
    contained(actions ? actions : footer, button);
    check(width(button) >= 44 - tolerance && height(button) >= 44 - tolerance, "message action target shrank below 44 points");
  }
  if (length == 1) {
    check(height(bubble) <= message.line + 2 * (bubblePadY + border) + tolerance, "short bubble contains surplus footer height");
    check(width(bubble) < width(row) * .5f, "short bubble stretched into a card");
  }
  YGNodeFreeRecursive(root);
}
void composerCase(YGConfigRef config, float screenWidth, float scale, float length, float bodyHeight, float cap, float minimum) {
  auto body = node(config); YGNodeStyleSetWidth(body, screenWidth); YGNodeStyleSetHeight(body, bodyHeight);
  auto history = node(config, body); YGNodeStyleSetFlex(history, 1); YGNodeStyleSetMinHeight(history, 0);
  auto bar = node(config, body); YGNodeStyleSetFlexDirection(bar, YGFlexDirectionRow); YGNodeStyleSetAlignItems(bar, YGAlignFlexEnd);
  YGNodeStyleSetFlexShrink(bar, 0); YGNodeStyleSetGap(bar, YGGutterAll, barGap);
  YGNodeStyleSetPadding(bar, YGEdgeHorizontal, barPadX); YGNodeStyleSetPadding(bar, YGEdgeTop, barPadTop); YGNodeStyleSetPadding(bar, YGEdgeBottom, barPadBottom);
  YGNodeStyleSetBorder(bar, YGEdgeTop, barBorderTop);
  Text draft { length * inputFont * .53f * scale, inputLine * scale }; auto input = textNode(config, bar, draft);
  YGNodeStyleSetFlex(input, 1); YGNodeStyleSetMinHeight(input, minimum); YGNodeStyleSetMaxHeight(input, cap);
  YGNodeStyleSetPadding(input, YGEdgeHorizontal, inputPadX); YGNodeStyleSetPadding(input, YGEdgeVertical, inputPadY); YGNodeStyleSetBorder(input, YGEdgeAll, inputBorder);
  auto send = node(config, bar); YGNodeStyleSetWidth(send, sendW); YGNodeStyleSetHeight(send, sendH);
  YGNodeCalculateLayout(body, YGUndefined, YGUndefined, YGDirectionLTR);
  contained(body, history); contained(body, bar); contained(bar, input); contained(bar, send);
  check(height(input) >= 44 - tolerance && height(input) <= cap + tolerance, "composer exceeds its measured body cap");
  const float lineWithInsets = draft.line + 2 * (inputPadY + inputBorder);
  const float barInsets = barPadTop + barPadBottom + barBorderTop;
  if (bodyHeight >= lineWithInsets + barInsets - tolerance) {
    check(height(input) >= lineWithInsets - tolerance, "composer clips a scaled line despite enough available space");
  }
  check(height(input) >= minimum - tolerance, "composer is below its dynamic minimum");
  check(width(input) > inputPadX * 2, "composer has no editable width");
  check(width(send) >= 44 - tolerance && height(send) >= 44 - tolerance, "send target shrank below 44 points");
  check(left(send) >= left(input) + width(input) + barGap - tolerance, "send target overlaps draft");
  check(top(bar) >= height(history) - tolerance, "composer covers message viewport");
  check(std::abs(top(bar) + height(bar) - bodyHeight) <= tolerance, "composer is not at the unobstructed body bottom");
  YGNodeFreeRecursive(body);
}
int main(int argc, char** argv) {
  check((argc - 1) % 7 == 0, "invalid geometry arguments");
  int bubbles = 0, composers = 0;
  auto config = YGConfigNew(); YGConfigSetErrata(config, YGErrataAll); YGConfigSetPointScaleFactor(config, 3);
  for (int i = 1; i + 6 < argc; i += 7) {
    currentKind = argv[i]; currentWidth = atof(argv[i + 1]); currentScale = atof(argv[i + 2]); currentLength = atof(argv[i + 3]); currentExtra = atof(argv[i + 4]);
    if (strcmp(currentKind, "bubble") == 0) { bubbleCase(config, currentWidth, currentScale, currentLength, currentExtra); bubbles++; }
    else { composerCase(config, currentWidth, currentScale, currentLength, currentExtra, atof(argv[i + 5]), atof(argv[i + 6])); composers++; }
  }
  YGConfigFree(config);
  printf("%d bubble + %d composer exact-Yoga geometry cases passed (synthetic text metrics; no native/device validation).\n", bubbles, composers);
}
