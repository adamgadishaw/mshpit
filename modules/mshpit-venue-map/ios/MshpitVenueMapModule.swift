import ExpoModulesCore

struct VenueMapPoint: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var latitude: Double = .nan
  @Field var longitude: Double = .nan
  @Field var number: Int = 0
}

// One prop makes selection + venue updates atomic, independent of prop order.
struct VenueMapSnapshot: Record {
  @Field var revision: String = ""
  @Field var venues: [VenueMapPoint] = []
  // Expo Fabric normalizes nested null to a boxed nil that Record cannot cast.
  // Use an empty string for no selection at this native boundary.
  @Field var selectedId: String = ""
}

public final class MshpitVenueMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MshpitVenueMap")
    View(MshpitVenueMapView.self) {
      Events("onVenueSelect", "onMapStatus")
      Prop("snapshot") { (view: MshpitVenueMapView, snapshot: VenueMapSnapshot) in
        view.apply(snapshot)
      }
    }
  }
}
