package com.runwhale.nodehost

import android.content.Context
import android.content.SharedPreferences
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Preview-only storage primitive used by the JavaScript AsyncStorage compatibility
 * layer. The preference file is selected from the validated native project scope;
 * user JavaScript never supplies or changes the namespace.
 */
internal class NativePreviewStorageModule : Module() {
  private val projectScope = NativePreviewProjectScopeContext.requireCurrent()

  private val preferences: SharedPreferences
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSharedPreferences(projectScope.storagePreferencesName, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    AsyncFunction("getItem") { key: String ->
      synchronized(preferences) { preferences.getString(key, null) }
    }

    AsyncFunction("setItem") { key: String, value: String ->
      synchronized(preferences) {
        preferences.edit().putString(key, value).commitOrThrow()
      }
    }

    AsyncFunction("removeItem") { key: String ->
      synchronized(preferences) {
        preferences.edit().remove(key).commitOrThrow()
      }
    }

    AsyncFunction("mergeItem") { key: String, value: String ->
      synchronized(preferences) {
        val merged = mergeNativePreviewStorageValues(preferences.getString(key, null), value)
        preferences.edit().putString(key, merged).commitOrThrow()
      }
    }

    AsyncFunction("clear") {
      synchronized(preferences) {
        preferences.edit().clear().commitOrThrow()
      }
    }

    AsyncFunction("getAllKeys") {
      synchronized(preferences) { preferences.all.keys.sorted() }
    }

    AsyncFunction("multiGet") { keys: List<String> ->
      synchronized(preferences) {
        keys.map { key -> listOf(key, preferences.getString(key, null)) }
      }
    }

    AsyncFunction("multiSet") { entries: List<List<String>> ->
      val pairs = entries.map(::requireStoragePair)
      synchronized(preferences) {
        val editor = preferences.edit()
        pairs.forEach { (key, value) -> editor.putString(key, value) }
        editor.commitOrThrow()
      }
    }

    AsyncFunction("multiRemove") { keys: List<String> ->
      synchronized(preferences) {
        val editor = preferences.edit()
        keys.forEach(editor::remove)
        editor.commitOrThrow()
      }
    }

    AsyncFunction("multiMerge") { entries: List<List<String>> ->
      val pairs = entries.map(::requireStoragePair)
      synchronized(preferences) {
        val merged = pairs.map { (key, value) ->
          key to mergeNativePreviewStorageValues(preferences.getString(key, null), value)
        }
        val editor = preferences.edit()
        merged.forEach { (key, value) -> editor.putString(key, value) }
        editor.commitOrThrow()
      }
    }
  }

  companion object {
    const val MODULE_NAME = "RunWhalePreviewStorage"
  }
}

private fun requireStoragePair(entry: List<String>): Pair<String, String> {
  require(entry.size == 2) { "AsyncStorage entries must contain one key and one value" }
  return entry[0] to entry[1]
}

private fun SharedPreferences.Editor.commitOrThrow() {
  check(commit()) { "Native Preview could not persist AsyncStorage data" }
}

internal fun mergeNativePreviewStorageValues(current: String?, incoming: String): String {
  if (current == null) return incoming
  val currentObject = JSONObject(current)
  mergeNativePreviewJson(currentObject, JSONObject(incoming))
  return currentObject.toString()
}

private fun mergeNativePreviewJson(current: JSONObject, incoming: JSONObject) {
  val keys = incoming.keys()
  while (keys.hasNext()) {
    val key = keys.next()
    val currentObject = current.optJSONObject(key)
    val incomingObject = incoming.optJSONObject(key)
    if (currentObject != null && incomingObject != null) {
      mergeNativePreviewJson(currentObject, incomingObject)
      current.put(key, currentObject)
    } else {
      current.put(key, incoming.get(key))
    }
  }
}
