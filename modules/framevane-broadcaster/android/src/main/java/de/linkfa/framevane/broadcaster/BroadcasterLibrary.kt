package de.linkfa.framevane.broadcaster

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File

/**
 * Where a finished recording goes, and how anything else on the phone reaches
 * it.
 *
 * The recorder writes to a path, and the only path this app can write to
 * without asking for storage permission is its own external files directory.
 * Nothing else on the phone can see inside that directory: not the gallery,
 * not a file manager, not a video player - which is why a recording could be
 * listed by this app, and be right there on the disk, and still open in
 * nothing. Handing out a FileProvider URI covers a player that accepts one,
 * and covers nothing else: the file is still invisible everywhere an operator
 * would think to look for it.
 *
 * So a finished take is moved into MediaStore, which is the phone's own video
 * library. From there it is in the gallery, in the Files app, in whatever
 * plays video, and in the Movies folder over USB - and it is still the app's
 * own entry, so it can be listed and deleted from here without asking the
 * operator for permission to read anybody else's media.
 *
 * Below Android 10 there is no MediaStore entry an app can create without the
 * old storage permission, so on those phones the take stays in the app folder
 * and the FileProvider path is the only way out. That is the behaviour every
 * recording had until now.
 */

/** The folder the operator will see in their gallery and over USB. */
private const val LIBRARY_FOLDER = "Framevane"

/** MediaStore grew the columns this needs in Android 10. */
internal val CAN_USE_LIBRARY = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

/**
 * Moves a finished take into the video library.
 *
 * Copy and then delete rather than rename: the two live on different volumes
 * as far as the system is concerned, and the bytes have to travel through the
 * content resolver either way. It runs on its own thread because a take can be
 * a couple of hundred megabytes and this is called from the recorder's
 * callback.
 *
 * The entry is inserted pending, so nothing indexes or offers a half-copied
 * file, and it is cleared at the end. A failure anywhere leaves the original
 * where it was: the operator keeps the recording, in the place the app can
 * still list.
 */
internal fun BroadcasterView.publishToLibrary(file: File) {
  if (!file.exists() || file.length() == 0L) return

  /**
   * A folder the operator picked wins over the library, and failing at it
   * falls through to the library rather than leaving the take where only this
   * app can see it.
   */
  val folder = recordingFolder
  if (folder.isNotEmpty()) {
    val view = this
    Thread {
      if (view.copyToFolder(file, folder)) {
        runCatching { file.delete() }
        view.log(LOG_INFO, "${file.name} saved to the chosen folder")
      } else {
        view.log(LOG_WARN, "The chosen folder would not take ${file.name}; trying the library")
        view.post { view.publishToLibraryOnly(file) }
      }
    }.start()
    return
  }

  publishToLibraryOnly(file)
}

private fun BroadcasterView.publishToLibraryOnly(file: File) {
  if (!CAN_USE_LIBRARY || !saveToGallery) return
  if (!file.exists() || file.length() == 0L) return

  // Named apart from the view's own `context`: this outlives the view, and a
  // background thread holding a view's context is how an Activity leaks.
  val appContext = context.applicationContext
  val view = this

  Thread {
    val resolver = appContext.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, file.name)
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$LIBRARY_FOLDER")
      put(MediaStore.Video.Media.IS_PENDING, 1)
      put(MediaStore.Video.Media.DATE_TAKEN, file.lastModified())
    }

    val uri = runCatching {
      resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
    }.getOrNull()

    if (uri == null) {
      view.log(LOG_WARN, "The video library would not take ${file.name}; it is still in the app folder")
      return@Thread
    }

    val copied = runCatching {
      resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        ?: throw IllegalStateException("no stream")
      true
    }.getOrElse {
      view.log(LOG_WARN, "Could not copy ${file.name} to the video library: ${it.message}")
      false
    }

    if (!copied) {
      // A pending entry nothing finished writing is litter: it is invisible to
      // the gallery and counts against storage until something removes it.
      runCatching { resolver.delete(uri, null, null) }
      return@Thread
    }

    runCatching {
      resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
    }
    runCatching { file.delete() }
    view.log(LOG_INFO, "${file.name} is in Movies/$LIBRARY_FOLDER")
  }.start()
}

/**
 * Copies a finished take into a folder the operator picked.
 *
 * Through DocumentsContract rather than androidx's DocumentFile, which would
 * be a dependency for two calls: a tree permission gives a document id, and
 * creating a file under it and opening a stream to it is the whole of what is
 * needed.
 *
 * Returns false on anything going wrong, and the caller falls back to the
 * library. A tree permission can be revoked by the system or by the operator
 * in Android's settings, and a recording must never be lost to a settings
 * problem - so a failure here costs the destination, not the take.
 */
internal fun BroadcasterView.copyToFolder(file: File, tree: String): Boolean {
  val appContext = context.applicationContext
  val treeUri = runCatching { Uri.parse(tree) }.getOrNull() ?: return false

  return runCatching {
    val resolver = appContext.contentResolver
    val parent = DocumentsContract.buildDocumentUriUsingTree(
      treeUri,
      DocumentsContract.getTreeDocumentId(treeUri),
    )
    val target = DocumentsContract.createDocument(resolver, parent, "video/mp4", file.name)
      ?: return false
    resolver.openOutputStream(target)?.use { out -> file.inputStream().use { it.copyTo(out) } }
      ?: return false
    true
  }.getOrElse {
    log(LOG_WARN, "Could not write to the chosen folder: ${it.message}")
    false
  }
}

/**
 * The takes in the video library that this app put there.
 *
 * Without READ_MEDIA_VIDEO an app sees only its own entries, which is exactly
 * the list wanted here - and is why this needs no permission and shows no
 * dialog.
 */
internal fun libraryRecordings(context: Context): List<Map<String, Any>> {
  if (!CAN_USE_LIBRARY) return emptyList()

  val columns = arrayOf(
    MediaStore.Video.Media._ID,
    MediaStore.Video.Media.DISPLAY_NAME,
    MediaStore.Video.Media.SIZE,
    MediaStore.Video.Media.DATE_MODIFIED,
    MediaStore.Video.Media.DURATION,
  )

  val entries = mutableListOf<Map<String, Any>>()
  runCatching {
    context.contentResolver.query(
      MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
      columns,
      "${MediaStore.Video.Media.RELATIVE_PATH} LIKE ?",
      arrayOf("%$LIBRARY_FOLDER%"),
      "${MediaStore.Video.Media.DATE_MODIFIED} DESC",
    )?.use { cursor ->
      val id = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
      val name = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
      val size = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
      val modified = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_MODIFIED)
      val duration = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)

      while (cursor.moveToNext()) {
        val uri = ContentUris.withAppendedId(
          MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
          cursor.getLong(id),
        )
        entries += mapOf(
          // The URI is the handle for everything downstream - opening,
          // deleting, telling one entry from another - so it travels as the
          // path. A library entry has no file path an app may use.
          "path" to uri.toString(),
          "name" to cursor.getString(name),
          "bytes" to cursor.getLong(size).toDouble(),
          // MediaStore counts this one in seconds and everything else in here
          // is milliseconds.
          "modifiedAt" to (cursor.getLong(modified) * 1000.0),
          "durationMs" to cursor.getLong(duration).toDouble(),
          "inLibrary" to true,
        )
      }
    }
  }.onFailure { entries.clear() }

  return entries
}

/** Removes one library entry. Ours to delete, so no dialog and no permission. */
internal fun deleteFromLibrary(context: Context, uri: Uri): Boolean =
  runCatching { context.contentResolver.delete(uri, null, null) > 0 }.getOrElse { false }

/**
 * Hands a recording to whatever plays video on this phone.
 *
 * A library entry already has a URI every app can read. A file in the app's
 * own folder does not, and has to be wrapped by the provider this module
 * declares - Android has refused a file:// URI across an app boundary since
 * Nougat.
 *
 * Through a chooser rather than a bare view intent. On a phone with no default
 * video player - and several manufacturers ship without one - a bare intent
 * fails with ActivityNotFound even though three apps could have opened it.
 */
internal fun openRecording(context: Context, path: String) {
  val uri = if (path.startsWith("content://")) {
    Uri.parse(path)
  } else {
    val file = File(path)
    if (!file.exists()) throw IllegalArgumentException("That recording is no longer on the phone")
    runCatching {
      FileProvider.getUriForFile(context, "${context.packageName}.recordings", file)
    }.getOrElse {
      // The message matters: this is the failure that looked like "no video
      // player installed" for as long as it went unreported.
      throw IllegalStateException("Could not make a link to ${file.name}: ${it.message}")
    }
  }

  val view = Intent(Intent.ACTION_VIEW)
    .setDataAndType(uri, "video/mp4")
    // Without this the receiving app holds a URI it has no permission to read,
    // and opens on a black frame or an error of its own.
    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

  val chooser = Intent.createChooser(view, "Open recording")
    // Started from outside an Activity, so it needs its own task.
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

  runCatching { context.startActivity(chooser) }.getOrElse {
    throw IllegalStateException("Nothing on this phone would open it: ${it.message}")
  }
}
