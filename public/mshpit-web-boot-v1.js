(function installMshpitWebBoot(globalObject) {
  "use strict";

  var documentObject = globalObject.document;
  var html = documentObject && documentObject.documentElement;
  if (!html) return;

  var attribute = "data-mshpit-web-boot";
  var pendingValue = "pending";
  var apiKey = "__MSHPIT_WEB_BOOT__";
  var timeoutMs = 8000;
  var settled = false;
  var timeoutId = null;

  // This file is parser-blocking in <head>, so the marker is installed before
  // the crawler document inside #root can be parsed or painted. Bump the file's
  // version when this contract changes so cached HTML never calls stale code.
  html.setAttribute(attribute, pendingValue);

  function removeListeners() {
    globalObject.removeEventListener("error", onError, true);
    globalObject.removeEventListener("unhandledrejection", complete);
  }

  function complete() {
    if (settled) return;
    settled = true;
    if (timeoutId !== null) {
      globalObject.clearTimeout(timeoutId);
      timeoutId = null;
    }
    removeListeners();
    if (html.getAttribute(attribute) === pendingValue) html.removeAttribute(attribute);
  }

  function onError(event) {
    var target = event && event.target;
    var tagName = target && typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
    // Resource errors do not bubble. Capture failed application scripts while
    // ignoring optional image/media failures that should not expose the shell.
    if (!target || target === globalObject || tagName === "SCRIPT") complete();
  }

  globalObject[apiKey] = { complete: complete };
  globalObject.addEventListener("error", onError, true);
  globalObject.addEventListener("unhandledrejection", complete);
  timeoutId = globalObject.setTimeout(complete, timeoutMs);
})(window);
