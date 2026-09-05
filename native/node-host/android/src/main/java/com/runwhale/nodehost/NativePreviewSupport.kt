package com.runwhale.nodehost

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal data class NativePreviewLaunchResult(
  val opened: Boolean,
  val code: String? = null,
  val message: String? = null,
)

/**
 * Bridges the Studio promise to the separate Preview Activity without making
 * the user runtime aware of the Studio React context or any privileged module.
 */
internal object NativePreviewLaunchCoordinator {
  private val lock = Any()
  private val callbacks = mutableMapOf<String, (NativePreviewLaunchResult) -> Unit>()
  private val cancellationsBeforeRegistration = linkedSetOf<String>()
  private val finishedRequests = linkedSetOf<String>()
  private val cancellationListeners = mutableMapOf<String, (String) -> Unit>()

  fun register(requestId: String, callback: (NativePreviewLaunchResult) -> Unit): Boolean {
    val cancelled = synchronized(lock) {
      check(requestId !in callbacks && requestId !in finishedRequests) {
        "Native Preview launch request is already registered"
      }
      if (cancellationsBeforeRegistration.remove(requestId)) {
        rememberFinished(requestId)
        true
      } else {
        callbacks[requestId] = callback
        false
      }
    }
    if (!cancelled) return true
    callback(cancelledLaunchResult())
    return false
  }

  fun complete(requestId: String, result: NativePreviewLaunchResult): Boolean {
    val callback = synchronized(lock) {
      val registered = callbacks.remove(requestId) ?: return false
      rememberFinished(requestId)
      registered
    }
    callback(result)
    return true
  }

  fun unregister(requestId: String) {
    synchronized(lock) {
      callbacks.remove(requestId)
      cancellationsBeforeRegistration.remove(requestId)
      finishedRequests.remove(requestId)
    }
  }

  fun isPending(requestId: String): Boolean = synchronized(lock) {
    requestId in callbacks
  }

  fun cancel(requestId: String): Boolean {
    var callback: ((NativePreviewLaunchResult) -> Unit)? = null
    var listeners = emptyList<(String) -> Unit>()
    val accepted = synchronized(lock) {
      if (requestId in finishedRequests || requestId in cancellationsBeforeRegistration) {
        false
      } else {
        callback = callbacks.remove(requestId)
        if (callback == null) {
          rememberBounded(cancellationsBeforeRegistration, requestId)
        } else {
          rememberFinished(requestId)
          listeners = cancellationListeners.values.toList()
        }
        true
      }
    }
    if (!accepted) return false
    val registeredCallback = callback ?: return true
    try {
      registeredCallback(cancelledLaunchResult())
    } finally {
      listeners.forEach { listener -> listener(requestId) }
    }
    return accepted
  }

  fun addCancellationListener(listener: (String) -> Unit): NativePreviewCancellationSubscription {
    val listenerId = UUID.randomUUID().toString()
    synchronized(lock) { cancellationListeners[listenerId] = listener }
    return NativePreviewCancellationSubscription {
      synchronized(lock) {
        if (cancellationListeners[listenerId] === listener) cancellationListeners.remove(listenerId)
      }
    }
  }

  private fun rememberFinished(requestId: String) {
    rememberBounded(finishedRequests, requestId)
  }

  private fun rememberBounded(requests: MutableSet<String>, requestId: String) {
    requests.add(requestId)
    if (requests.size > MAX_REMEMBERED_REQUESTS) requests.remove(requests.first())
  }

  private fun cancelledLaunchResult() = NativePreviewLaunchResult(
    opened = false,
    code = "launch_cancelled",
    message = "Native Preview launch was cancelled",
  )

  private const val MAX_REMEMBERED_REQUESTS = 64
}

internal class NativePreviewCancellationSubscription(
  private val removeListener: () -> Unit,
) {
  fun remove() = removeListener()
}

internal class NativePreviewRequestGate {
  private var currentRequestId: String? = null

  @Synchronized
  fun begin(requestId: String): Boolean {
    if (currentRequestId != null) return false
    currentRequestId = requestId
    return true
  }

  @Synchronized
  fun finish(requestId: String): Boolean {
    if (currentRequestId != requestId) return false
    currentRequestId = null
    return true
  }

  @Synchronized
  fun isCurrent(requestId: String): Boolean = currentRequestId == requestId
}

internal fun shouldFinishNativePreviewAfterCancellation(
  pendingRequestIds: MutableSet<String>,
  requestId: String,
): Boolean {
  if (!pendingRequestIds.remove(requestId)) return false
  return pendingRequestIds.isEmpty()
}

internal fun isSameNativePreviewHostIdentity(
  currentSourceIdentifier: String?,
  currentProjectIdentifier: String?,
  nextSourceIdentifier: String,
  nextProjectIdentifier: String,
): Boolean =
  currentSourceIdentifier == nextSourceIdentifier &&
    currentProjectIdentifier == nextProjectIdentifier

internal object NativePreviewActionCoordinator {
  @Volatile
  private var listener: ((NativePreviewAction) -> Unit)? = null

  fun setListener(next: ((NativePreviewAction) -> Unit)?) {
    listener = next
  }

  fun emitReload() {
    listener?.invoke(NativePreviewAction(action = "reload"))
  }

  fun emitFailure(message: String) {
    listener?.invoke(NativePreviewAction(action = "failure", message = message))
  }
}

internal data class NativePreviewAction(
  val action: String,
  val message: String? = null,
) {
  fun toMap(): Map<String, String> = buildMap {
    put("action", action)
    message?.let { put("message", it) }
  }
}

internal object NativePreviewDiagnostics {
  const val PREFERENCES = "runwhale-native-preview"
  const val KEY = "last-diagnostic"

  private val urlPattern = Regex("(?i)\\bhttps?://[^\\s\\\"'<>]+")
  private val secretPattern = Regex(
    "(?i)\\b(authorization\\s*[=:]\\s*(?:bearer\\s+)?|(?:token|password|secret|api[_-]?key)\\s*[=:]\\s*)[^\\s,;\\\"']+",
  )
  private val privatePathPattern = Regex(
    "(?<![A-Za-z0-9])/(?:data|storage|sdcard|Users|Volumes|private|var|tmp)/[^\\s:;,\\\"']+",
  )
  private val whitespacePattern = Regex("\\s+")

  fun clear(context: Context) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY)
      .apply()
  }

  fun record(
    context: Context,
    stage: String,
    code: String,
    rawMessage: String?,
    fallbackMessage: String,
  ): String {
    val message = sanitize(rawMessage, fallbackMessage)
    val diagnostic = JSONObject()
      .put("version", 1)
      .put("platform", "android")
      .put("stage", stage)
      .put("code", code)
      .put("message", message)
      .put("timestamp", System.currentTimeMillis())
      .toString()
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, diagnostic)
      .apply()
    return message
  }

  fun sanitize(rawMessage: String?, fallbackMessage: String): String {
    val raw = rawMessage?.takeIf { it.isNotBlank() } ?: fallbackMessage
    return raw
      .replace(urlPattern, "<redacted-url>")
      .replace(secretPattern) { match -> "${match.groupValues[1]}<redacted>" }
      .replace(privatePathPattern, "<redacted-path>")
      .replace(whitespacePattern, " ")
      .trim()
      .take(MAX_MESSAGE_LENGTH)
      .ifEmpty { fallbackMessage }
  }

  private const val MAX_MESSAGE_LENGTH = 2_048
}
