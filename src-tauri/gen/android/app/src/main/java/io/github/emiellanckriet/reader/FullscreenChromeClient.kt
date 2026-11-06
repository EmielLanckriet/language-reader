package io.github.emiellanckriet.reader

import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Full screen for the web app (issue #55). Wry's generated RustWebChromeClient answers
 * onShowCustomView by hiding the view at once, so `requestFullscreen` ended the moment it began.
 * That class is final and regenerated on every build, so this one wraps it instead: it shows the
 * full-screen view itself and forwards every method wry overrides (as of wry 0.57.1) to wry's.
 * A method wry starts overriding later would not be forwarded — compare after a Tauri upgrade.
 *
 * Landscape and hidden system bars are done here: the WebView has no `screen.orientation.lock`.
 */
class FullscreenChromeClient(
  private val activity: TauriActivity,
  private val inner: WebChromeClient,
) : WebChromeClient() {
  private var shown: View? = null
  private var hidden: CustomViewCallback? = null
  private var orientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

  /** Back leaves full screen instead of navigating the web app back. */
  private val back = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      hidden?.onCustomViewHidden()
    }
  }

  init {
    activity.onBackPressedDispatcher.addCallback(activity, back)
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    if (shown != null) {
      callback.onCustomViewHidden()
      return
    }
    shown = view
    hidden = callback
    val decor = activity.window.decorView as ViewGroup
    decor.addView(
      view,
      FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
    WindowCompat.getInsetsController(activity.window, decor).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
    orientation = activity.requestedOrientation
    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    back.isEnabled = true
  }

  override fun onHideCustomView() {
    val view = shown ?: return
    shown = null
    back.isEnabled = false
    val decor = activity.window.decorView as ViewGroup
    decor.removeView(view)
    WindowCompat.getInsetsController(activity.window, decor)
      .show(WindowInsetsCompat.Type.systemBars())
    activity.requestedOrientation = orientation
    hidden?.onCustomViewHidden()
    hidden = null
  }

  override fun onPermissionRequest(request: PermissionRequest) = inner.onPermissionRequest(request)

  override fun getDefaultVideoPoster(): Bitmap? = inner.defaultVideoPoster

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult) =
    inner.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult) =
    inner.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(
    view: WebView,
    url: String,
    message: String,
    defaultValue: String,
    result: JsPromptResult
  ) = inner.onJsPrompt(view, url, message, defaultValue, result)

  override fun onGeolocationPermissionsShowPrompt(
    origin: String,
    callback: GeolocationPermissions.Callback
  ) = inner.onGeolocationPermissionsShowPrompt(origin, callback)

  override fun onShowFileChooser(
    webView: WebView,
    filePathCallback: ValueCallback<Array<Uri>>,
    fileChooserParams: FileChooserParams
  ) = inner.onShowFileChooser(webView, filePathCallback, fileChooserParams)

  override fun onConsoleMessage(consoleMessage: ConsoleMessage) =
    inner.onConsoleMessage(consoleMessage)

  override fun onReceivedTitle(view: WebView, title: String) = inner.onReceivedTitle(view, title)
}
