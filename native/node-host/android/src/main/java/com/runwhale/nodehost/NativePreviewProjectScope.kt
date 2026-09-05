package com.runwhale.nodehost

import android.content.Context
import expo.modules.kotlin.services.AppDirectoriesService
import expo.modules.kotlin.services.FilePermissionService
import expo.modules.kotlin.services.ServiceInterface
import java.io.File
import java.io.IOException
import java.util.EnumSet

internal data class NativePreviewProjectScope(
  val projectId: String,
  val persistentFilesDirectory: File,
  val cacheDirectory: File,
  val storagePreferencesName: String,
) {
  fun permissionsForPath(path: String): EnumSet<FilePermissionService.Permission> {
    val candidate = try {
      File(path).takeIf(File::isAbsolute)?.canonicalFile
    } catch (_: IOException) {
      null
    } ?: return noPermissions()

    return if (
      candidate.isWithin(persistentFilesDirectory) ||
        candidate.isWithin(cacheDirectory)
    ) {
      EnumSet.of(FilePermissionService.Permission.READ, FilePermissionService.Permission.WRITE)
    } else {
      noPermissions()
    }
  }

  companion object {
    val PROJECT_ID_PATTERN = Regex("[a-z0-9][a-z0-9-]{1,62}")

    fun create(context: Context, projectId: String): NativePreviewProjectScope = create(
      filesDirectory = context.filesDir,
      cacheDirectory = context.cacheDir,
      projectId = projectId,
    )

    internal fun create(
      filesDirectory: File,
      cacheDirectory: File,
      projectId: String,
    ): NativePreviewProjectScope {
      require(PROJECT_ID_PATTERN.matches(projectId)) {
        "Native Preview project identifier is invalid"
      }

      val persistentRoot = isolatedDirectory(filesDirectory, projectId, "files")
      val cacheRoot = isolatedDirectory(cacheDirectory, projectId, "cache")
      return NativePreviewProjectScope(
        projectId = projectId,
        persistentFilesDirectory = persistentRoot,
        cacheDirectory = cacheRoot,
        storagePreferencesName = "runwhale-native-preview-storage-$projectId",
      )
    }

    private fun isolatedDirectory(
      applicationDirectory: File,
      projectId: String,
      leaf: String,
    ): File {
      val applicationRoot = applicationDirectory.canonicalFile
      val previewRoot = ensureDirectory(
        File(applicationRoot, "runwhale-native-preview"),
        applicationRoot,
      )
      val projectsRoot = ensureDirectory(File(previewRoot, "projects"), previewRoot)
      val projectRoot = ensureDirectory(File(projectsRoot, projectId), projectsRoot)
      return ensureDirectory(File(projectRoot, leaf), projectRoot)
    }

    private fun ensureDirectory(candidate: File, parent: File): File {
      if (!candidate.mkdirs() && !candidate.isDirectory) {
        throw IllegalStateException("Native Preview could not create its project storage")
      }
      val canonical = candidate.canonicalFile
      val expected = File(parent.canonicalFile, candidate.name).absoluteFile
      require(canonical == expected) {
        "Native Preview project storage escaped its application directory"
      }
      return canonical
    }
  }
}

private fun File.isWithin(root: File): Boolean {
  val rootPath = root.path
  return this == root || path.startsWith("$rootPath${File.separator}")
}

private fun noPermissions(): EnumSet<FilePermissionService.Permission> =
  EnumSet.noneOf(FilePermissionService.Permission::class.java)

internal object NativePreviewProjectScopeContext {
  private val activeScope = ThreadLocal<NativePreviewProjectScope?>()

  fun requireCurrent(): NativePreviewProjectScope = requireNotNull(activeScope.get()) {
    "Native Preview project scope is unavailable"
  }

  fun <Result> withScope(
    scope: NativePreviewProjectScope,
    block: () -> Result,
  ): Result {
    val previous = activeScope.get()
    activeScope.set(scope)
    return try {
      block()
    } finally {
      if (previous == null) activeScope.remove() else activeScope.set(previous)
    }
  }
}

@ServiceInterface(AppDirectoriesService::class)
internal class NativePreviewAppDirectoriesService(
  context: Context,
) : AppDirectoriesService(context) {
  private val scope = NativePreviewProjectScopeContext.requireCurrent()

  override val persistentFilesDirectory: File
    get() = scope.persistentFilesDirectory

  override val cacheDirectory: File
    get() = scope.cacheDirectory
}

@ServiceInterface(FilePermissionService::class)
internal class NativePreviewFilePermissionService : FilePermissionService() {
  private val scope = NativePreviewProjectScopeContext.requireCurrent()

  override val isScoped = true

  override fun getPathPermissions(
    context: Context,
    path: String,
  ): EnumSet<Permission> = scope.permissionsForPath(path)

  override fun getExternalPathPermissions(path: String): EnumSet<Permission> = noPermissions()
}
