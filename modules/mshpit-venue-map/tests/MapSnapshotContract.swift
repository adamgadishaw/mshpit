import ExpoModulesCore
import MapKit
import UIKit

// Compile with the two module sources in a temporary iOS host application.
// Invoke on the main thread with a view already attached to a UIWindow.
// These exercise real Expo Record/Fabric conversion, not network tile rendering.
// This file is outside the podspec's ios/*.swift production source glob.
@MainActor
func runVenueMapSnapshotContract(in root: UIView, appContext: AppContext,
                                 report: (String, [String: Any]) -> Void) {
  func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError("Map snapshot contract: \(message)") }
  }
  expect(Thread.isMainThread && root.window != nil, "requires an attached main-thread host")
  var points: [[String: Any]] = []
  for number in 1...24 {
    let latitude = 43.65 + Double(number) * 0.001
    let longitude = -79.39 + Double(number) * 0.001
    let point: [String: Any] = ["id": "toronto-\(number)", "name": "Toronto fixture \(number)",
      "latitude": latitude, "longitude": longitude, "number": number]
    points.append(point)
  }
  func snapshot(_ selection: String, revision: String = "fixture-r1") -> [String: Any] {
    ["revision": revision, "venues": points, "selectedId": selection]
  }
  let decoded = try! VenueMapSnapshot.from(dictionary: snapshot(""), appContext: appContext)
  expect(decoded.revision == "fixture-r1" && decoded.venues.count == 24, "hydrate revision and all points")
  expect(decoded.selectedId == "", "empty string is the no-selection wire value")
  expect(decoded.venues.first?.id == "toronto-1" && decoded.venues.last?.number == 24, "hydrate nested fields")
  expect(abs(decoded.venues[0].latitude - 43.651) < 0.000001, "hydrate numeric coordinate")
  let omitted = try! VenueMapSnapshot.from(dictionary: ["revision": "omitted", "venues": points], appContext: appContext)
  expect(omitted.selectedId == "", "omitted selection uses the same non-null default")

  let definition = MshpitVenueMapModule(appContext: appContext).definition()
  // Use the registered definition's factory: plain init lacks Expo's private
  // viewDefinition and its inherited updateProps would silently do nothing.
  let views = Mirror(reflecting: definition).children.first { $0.label == "views" }!.value as! [String: AnyViewDefinition]
  let viewDefinition = views["DEFAULT_MODULE_VIEW"]!
  guard case .uikit(let ui)? = viewDefinition.createView(appContext: appContext),
    let view = ui as? MshpitVenueMapView else { fatalError("Map view factory") }
  var statuses: [[String: Any]] = []
  var selections: [[String: Any]] = []
  view.onMapStatus.onEventSent = { statuses.append($0) }
  view.onVenueSelect.onEventSent = { selections.append($0) }
  let map = view.subviews.compactMap { $0 as? MKMapView }.first!
  view.frame = CGRect(x: 0, y: 0, width: 350, height: 250)
  // Fabric commonly supplies props before parent mount and child layout.
  view.updateProps(["snapshot": snapshot("")])
  expect(map.annotations.count == 24, "Fabric hydrates unselected snapshot before mount")
  root.addSubview(view)
  view.setNeedsLayout(); view.layoutIfNeeded()
  expect(abs(map.region.center.latitude - 43.66) < 0.1 && abs(map.region.center.longitude + 79.38) < 0.1, "camera fits Toronto")
  expect(map.region.span.latitudeDelta < 1 && map.region.span.longitudeDelta < 1, "camera is not continental")
  let annotationIdentities = Set(map.annotations.map { ObjectIdentifier($0 as AnyObject) })
  let span = map.region.span
  view.mapViewDidFinishRenderingMap(map, fullyRendered: true)
  expect(statuses.contains { $0["revision"] as? String == "fixture-r1" && $0["status"] as? String == "ready" }, "ready sends matching revision and string status")
  report("fabric-unselected", ["annotations": map.annotations.count,
    "latitude": map.region.center.latitude, "longitude": map.region.center.longitude,
    "revision": "fixture-r1", "status": "ready"])

  for selection in ["toronto-3", "", "toronto-24", ""] {
    view.updateProps(["snapshot": snapshot(selection)])
    expect(Set(map.annotations.map { ObjectIdentifier($0 as AnyObject) }) == annotationIdentities, "selection does not rebuild pins")
    if selection.isEmpty {
      expect(map.selectedAnnotations.isEmpty, "clear selection deselects native annotation")
    } else {
      let number = selection.components(separatedBy: "-").last!
      expect(map.selectedAnnotations.count == 1 && map.selectedAnnotations.first?.title == "Toronto fixture \(number)", "select matching annotation")
    }
    expect(abs(map.region.span.latitudeDelta - span.latitudeDelta) < 0.000001 && abs(map.region.span.longitudeDelta - span.longitudeDelta) < 0.000001, "selection preserves zoom")
    expect(selections.isEmpty, "programmatic selection does not emit user selection")
    report("fabric-selection", ["selectedId": selection, "selectedCount": map.selectedAnnotations.count, "annotations": map.annotations.count])
  }
  let annotation = map.annotations.first { $0.title == "Toronto fixture 3" }!
  let marker = view.mapView(map, viewFor: annotation)!
  view.mapView(map, didSelect: marker)
  expect(selections.count == 1 && selections[0]["id"] as? String == "toronto-3"
    && selections[0]["revision"] as? String == "fixture-r1", "user selection sends current string ID and revision")

  view.updateProps(["snapshot": snapshot("", revision: "fixture-r2")])
  view.mapViewDidFinishRenderingMap(map, fullyRendered: true)
  expect(statuses.last?["revision"] as? String == "fixture-r2" && statuses.last?["status"] as? String == "ready", "replacement revision reports ready")
  expect(map.annotations.count == 24 && map.selectedAnnotations.isEmpty, "replacement revision remains unselected with all pins")
  let statusCount = statuses.count, selectionCount = selections.count
  view.removeFromSuperview()
  view.mapViewDidFinishRenderingMap(map, fullyRendered: false)
  view.mapView(map, didSelect: marker)
  expect(statuses.count == statusCount && selections.count == selectionCount, "detach suppresses late events")
  report("PASS", ["record": "hydrated", "fabric": "hydrated", "selection": "selected/cleared",
    "events": "matching string revision/status/id; detached suppressed", "tiles": "not asserted"])
}
