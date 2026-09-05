Pod::Spec.new do |s|
  s.name           = 'RunWhaleNodeHost'
  s.version        = '1.0.0'
  s.summary        = 'Embedded Node 24 host for RunWhale'
  s.description    = 'Runs one embedded Node instance on a private serial thread.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = 'RunWhale'
  s.homepage       = 'https://github.com/zhiqingchen/RunWhale'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => 'https://github.com/zhiqingchen/RunWhale.git', :tag => s.version.to_s }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'
  s.dependency 'React-RCTAppDelegate'
  s.dependency 'React-RCTFabric'
  s.dependency 'RunWhaleNodeMobileRuntime', '24.19.0-runwhale.1'
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.resources      = ['runtime/runwhale-runtime.mjs', 'runtime/runwhale-agent-runtime.mjs', 'runtime/runwhale-task-worker.mjs', 'runtime/runwhale-package-worker.mjs', 'runtime/worker.cjs', 'runtime/runwhale-module-store.tgz']
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_ROOT)/Headers/Public/React-Core-prebuilt/Yoga"'
  }
end
