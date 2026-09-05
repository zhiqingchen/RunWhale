#include <jni.h>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <unistd.h>
#include <vector>

namespace node {
int Start(int argc, char* argv[]);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_runwhale_nodehost_NodeRuntime_startNode(
    JNIEnv* env,
    jobject,
    jobjectArray arguments,
    jstring working_directory) {
  const char* cwd = env->GetStringUTFChars(working_directory, nullptr);
  if (chdir(cwd) != 0) {
    env->ReleaseStringUTFChars(working_directory, cwd);
    return -1;
  }
  env->ReleaseStringUTFChars(working_directory, cwd);

  const jsize argc = env->GetArrayLength(arguments);
  std::vector<std::string> strings;
  strings.reserve(static_cast<size_t>(argc));
  size_t byte_count = 0;
  for (jsize i = 0; i < argc; ++i) {
    auto value = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
    const char* text = env->GetStringUTFChars(value, nullptr);
    strings.emplace_back(text);
    byte_count += strings.back().size() + 1;
    env->ReleaseStringUTFChars(value, text);
    env->DeleteLocalRef(value);
  }

  auto storage = std::make_unique<char[]>(byte_count);
  std::vector<char*> argv;
  argv.reserve(static_cast<size_t>(argc));
  char* cursor = storage.get();
  for (const auto& value : strings) {
    std::memcpy(cursor, value.c_str(), value.size() + 1);
    argv.push_back(cursor);
    cursor += value.size() + 1;
  }
  return node::Start(argc, argv.data());
}
