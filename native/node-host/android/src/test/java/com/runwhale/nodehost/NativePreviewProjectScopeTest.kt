package com.runwhale.nodehost

import expo.modules.kotlin.services.FilePermissionService
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class NativePreviewProjectScopeTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `project identifiers use the runtime's exact bounded format`() {
    val valid = listOf("ab", "expo-project", "a1", "a" + "b".repeat(62))
    val invalid = listOf(
      "",
      "a",
      "-project",
      "Project",
      "project_1",
      "project/other",
      "a" + "b".repeat(63),
    )

    valid.forEach { assertTrue(it, NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(it)) }
    invalid.forEach { assertFalse(it, NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(it)) }
  }

  @Test
  fun `each project receives deterministic distinct roots and namespaces`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val first = NativePreviewProjectScope.create(files, cache, "first-project")
    val same = NativePreviewProjectScope.create(files, cache, "first-project")
    val second = NativePreviewProjectScope.create(files, cache, "second-project")

    assertEquals(first.persistentFilesDirectory, same.persistentFilesDirectory)
    assertEquals(first.cacheDirectory, same.cacheDirectory)
    assertEquals(first.storagePreferencesName, same.storagePreferencesName)
    assertNotEquals(first.persistentFilesDirectory, second.persistentFilesDirectory)
    assertNotEquals(first.cacheDirectory, second.cacheDirectory)
    assertNotEquals(first.storagePreferencesName, second.storagePreferencesName)
    assertTrue(first.persistentFilesDirectory.isDirectory)
    assertTrue(first.cacheDirectory.isDirectory)
  }

  @Test
  fun `permissions are limited to canonical project roots`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val scope = NativePreviewProjectScope.create(files, cache, "first-project")
    val document = File(scope.persistentFilesDirectory, "nested/data.json")
    val cached = File(scope.cacheDirectory, "image.png")
    val sibling = NativePreviewProjectScope.create(files, cache, "second-project")

    assertReadWrite(scope, scope.persistentFilesDirectory)
    assertReadWrite(scope, document)
    assertReadWrite(scope, cached)
    assertNoPermissions(scope, sibling.persistentFilesDirectory)
    assertNoPermissions(scope, File(scope.persistentFilesDirectory, "../outside"))
    assertNoPermissions(scope, File("relative/path"))
    assertTrue(scope.permissionsForPath("content://provider/document").isEmpty())
  }

  @Test
  fun `canonical permission checks reject a symlink escape`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val outside = temporaryFolder.newFolder("outside")
    val scope = NativePreviewProjectScope.create(files, cache, "first-project")
    val link = File(scope.persistentFilesDirectory, "external-link")
    Files.createSymbolicLink(link.toPath(), outside.toPath())

    assertNoPermissions(scope, File(link, "secret.txt"))
  }

  @Test
  fun `project roots reject symlink aliases to another project`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val existing = NativePreviewProjectScope.create(files, cache, "second-project")
    val projectsDirectory = existing.persistentFilesDirectory.parentFile.parentFile
    Files.createSymbolicLink(
      File(projectsDirectory, "first-project").toPath(),
      existing.persistentFilesDirectory.parentFile.toPath(),
    )

    try {
      NativePreviewProjectScope.create(files, cache, "first-project")
      fail("Expected a project root symlink to be rejected")
    } catch (_: IllegalArgumentException) {
    }
  }

  @Test
  fun `scope context restores the previous project after nesting`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val first = NativePreviewProjectScope.create(files, cache, "first-project")
    val second = NativePreviewProjectScope.create(files, cache, "second-project")

    NativePreviewProjectScopeContext.withScope(first) {
      assertEquals(first, NativePreviewProjectScopeContext.requireCurrent())
      NativePreviewProjectScopeContext.withScope(second) {
        assertEquals(second, NativePreviewProjectScopeContext.requireCurrent())
      }
      assertEquals(first, NativePreviewProjectScopeContext.requireCurrent())
    }
  }

  @Test
  fun `preview file permission service is authoritative for every uri scheme`() {
    val files = temporaryFolder.newFolder("files")
    val cache = temporaryFolder.newFolder("cache")
    val scope = NativePreviewProjectScope.create(files, cache, "first-project")

    NativePreviewProjectScopeContext.withScope(scope) {
      assertTrue(NativePreviewFilePermissionService().isScoped)
    }
  }

  @Test
  fun `host identity includes the project as well as the bundle source`() {
    assertTrue(
      isSameNativePreviewHostIdentity(
        currentSourceIdentifier = "same-source",
        currentProjectIdentifier = "first-project",
        nextSourceIdentifier = "same-source",
        nextProjectIdentifier = "first-project",
      ),
    )
    assertFalse(
      isSameNativePreviewHostIdentity(
        currentSourceIdentifier = "same-source",
        currentProjectIdentifier = "first-project",
        nextSourceIdentifier = "same-source",
        nextProjectIdentifier = "second-project",
      ),
    )
  }

  private fun assertReadWrite(scope: NativePreviewProjectScope, file: File) {
    assertEquals(
      setOf(FilePermissionService.Permission.READ, FilePermissionService.Permission.WRITE),
      scope.permissionsForPath(file.path),
    )
  }

  private fun assertNoPermissions(scope: NativePreviewProjectScope, file: File) {
    assertTrue(scope.permissionsForPath(file.path).isEmpty())
  }
}
