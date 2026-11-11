Pod::Spec.new do |s|
  s.name = 'MshpitVenueMap'
  s.version = '1.0.0'
  s.summary = 'App-local iOS venue map using Apple MapKit'
  s.description = 'Displays supplied venue coordinates without device location access.'
  s.license = { :type => 'Proprietary' }
  s.author = 'mshpit'
  s.homepage = 'https://mshpit.com'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MapKit'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
