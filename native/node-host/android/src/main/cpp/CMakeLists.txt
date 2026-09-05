cmake_minimum_required(VERSION 3.22.1)
project(runwhale_node_host LANGUAGES C CXX)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
  IMPORTED_LOCATION
    "${NODE_MOBILE_RUNTIME_ROOT}/android/jni/${ANDROID_ABI}/libnode.so"
)

add_library(runwhale-node-host SHARED node_host.cpp)
target_include_directories(runwhale-node-host PRIVATE
  "${NODE_MOBILE_RUNTIME_ROOT}/android/include/node"
)
target_link_libraries(runwhale-node-host node android log)
