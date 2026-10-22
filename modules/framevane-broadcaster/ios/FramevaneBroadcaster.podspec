Pod::Spec.new do |s|
  s.name           = 'FramevaneBroadcaster'
  s.version        = '0.1.0'
  s.summary        = 'Camera preview and RTMP/SRT publishing for Framevane.'
  s.author         = 'Framevane'
  s.homepage       = 'https://framevane.linkfa.de'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # RootEncoder for iOS is the counterpart of the Android library and speaks
  # the same two protocols. It is not wired up yet - see BroadcasterModule.swift.
  # s.dependency 'RootEncoder', '~> 2.4'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
