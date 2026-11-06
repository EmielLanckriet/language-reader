package io.github.emiellanckriet.reader

import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge lays the WebView under the status and gesture bars (Sapling hit the same):
    // pad the content view by them, and by the keyboard, so the web app needs to know nothing.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    // Wry sets its chrome client only after this hook returns, so wrap it on the next turn.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    webView.post {
      val inner = webView.webChromeClient ?: return@post
      webView.webChromeClient = FullscreenChromeClient(this, inner)
    }
  }
}
