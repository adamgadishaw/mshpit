import ExpoModulesCore
import MapKit

private final class VenueAnnotation: NSObject, MKAnnotation {
  let point: VenueMapPoint
  let coordinate: CLLocationCoordinate2D
  var title: String? { point.name }

  init(_ point: VenueMapPoint) {
    self.point = point
    coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
  }
}

final class MshpitVenueMapView: ExpoView, MKMapViewDelegate {
  let onVenueSelect = EventDispatcher()
  let onMapStatus = EventDispatcher()
  private let mapView = MKMapView()
  private var revision = ""
  private var selectedId: String?
  private var annotations: [VenueAnnotation] = []
  private var needsFit = true
  private var applyingSelection = false
  private var lastStatus: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    mapView.mapType = .standard
    mapView.pointOfInterestFilter = .excludingAll
    mapView.isPitchEnabled = false
    mapView.isRotateEnabled = false
    // MapKit's location/tracking defaults remain off. No location manager or
    // permission request is created. Keep all native attribution/control views.
    mapView.delegate = self
    addSubview(mapView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mapView.frame = bounds
    fitIfNeeded()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    mapView.delegate = window == nil ? nil : self
    if window != nil { fitIfNeeded() }
  }

  func apply(_ snapshot: VenueMapSnapshot) {
    let isNewRevision = revision != snapshot.revision
    revision = snapshot.revision
    selectedId = snapshot.selectedId
    if isNewRevision {
      lastStatus = nil
      var ids = Set<String>()
      let points = snapshot.venues.prefix(24).filter { point in
        !point.id.isEmpty && point.latitude.isFinite && point.longitude.isFinite
          && abs(point.latitude) <= 85 && abs(point.longitude) <= 180
          && ids.insert(point.id).inserted
      }
      applyingSelection = true
      mapView.removeAnnotations(annotations)
      annotations = points.map(VenueAnnotation.init)
      mapView.addAnnotations(annotations)
      applyingSelection = false
      needsFit = true
      setNeedsLayout()
    }
    synchronizeSelection()
    fitIfNeeded()
  }

  private func fitIfNeeded() {
    guard needsFit, window != nil, bounds.width > 0, bounds.height > 0,
      !annotations.isEmpty else { return }
    needsFit = false
    if annotations.count == 1, let point = annotations.first {
      mapView.setRegion(MKCoordinateRegion(center: point.coordinate,
        latitudinalMeters: 2500, longitudinalMeters: 2500), animated: false)
    } else {
      // MapKit handles the antimeridian and projection. Never synthesize roads.
      mapView.showAnnotations(annotations, animated: false)
    }
    synchronizeSelection()
  }

  private func synchronizeSelection() {
    applyingSelection = true
    defer { applyingSelection = false }
    for current in mapView.selectedAnnotations {
      if (current as? VenueAnnotation)?.point.id != selectedId {
        mapView.deselectAnnotation(current, animated: false)
      }
    }
    for annotation in annotations {
      if let view = mapView.view(for: annotation) as? MKMarkerAnnotationView {
        configure(view, for: annotation)
      }
    }
    guard let selected = annotations.first(where: { $0.point.id == selectedId }) else { return }
    if !needsFit && !mapView.visibleMapRect.contains(MKMapPoint(selected.coordinate)) {
      mapView.setCenter(selected.coordinate, animated: false)
    }
    mapView.selectAnnotation(selected, animated: false)
  }

  private func configure(_ view: MKMarkerAnnotationView, for annotation: VenueAnnotation) {
    let active = annotation.point.id == selectedId
    view.glyphText = String(annotation.point.number)
    view.markerTintColor = active ? .systemOrange : .darkGray
    view.glyphTintColor = .white
    view.displayPriority = active ? .required : .defaultHigh
    view.canShowCallout = true
    view.accessibilityLabel = "Venue \(annotation.point.number): \(annotation.point.name)"
    view.accessibilityHint = "Selects this venue in the list below."
    view.accessibilityTraits = active ? [.button, .selected] : .button
  }

  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    guard let venue = annotation as? VenueAnnotation else { return nil }
    let view = mapView.dequeueReusableAnnotationView(withIdentifier: "venue") as? MKMarkerAnnotationView
      ?? MKMarkerAnnotationView(annotation: venue, reuseIdentifier: "venue")
    view.annotation = venue
    configure(view, for: venue)
    return view
  }

  func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
    guard !applyingSelection, window != nil,
      let annotation = view.annotation as? VenueAnnotation,
      annotations.contains(where: { $0 === annotation }),
      annotation.point.id != selectedId else { return }
    onVenueSelect(["revision": revision, "id": annotation.point.id])
  }

  private func report(_ status: String) {
    guard window != nil, !needsFit, !revision.isEmpty, lastStatus != status else { return }
    lastStatus = status
    onMapStatus(["revision": revision, "status": status])
  }

  func mapViewDidFinishRenderingMap(_ mapView: MKMapView, fullyRendered: Bool) {
    // An incomplete frame is not proof of loaded street tiles. JS also bounds
    // the wait in case MapKit never reports a completed render or an error.
    report(fullyRendered ? "ready" : "partial")
  }

  func mapViewDidFailLoadingMap(_ mapView: MKMapView, withError error: Error) {
    // A failed tile request can overlap an in-flight request. Preserve a map
    // that has rendered, disclose the partial result, and offer an explicit retry.
    report("partial")
  }
}
