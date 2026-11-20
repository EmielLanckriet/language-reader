package io.github.emiellanckriet.reader

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

/**
 * A card's word spoken by Android's own text-to-speech, as window.ReaderSpeech. The WebView has no
 * speechSynthesis (measured 2026-11-20: undefined in WebView 157 on Android 13), so cards were
 * silent in the native app. Each utterance's end comes back as a `readerspeech` event on window.
 */
class WordSpeech(context: Context, private val webView: WebView) {
  /** Null while the engine starts; then whether it has a Mandarin voice. */
  @Volatile private var ready: Boolean? = null
  /** A word asked for while the engine was starting: [id, text]. */
  private var pending: Pair<String, String>? = null
  private val tts: TextToSpeech

  init {
    tts = TextToSpeech(context.applicationContext) { status -> started(status) }
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String) {}
      override fun onDone(id: String) = tell(id, "end")
      @Deprecated("Deprecated in Java")
      override fun onError(id: String) = tell(id, "error")
      override fun onError(id: String, code: Int) = tell(id, "error")
      override fun onStop(id: String, interrupted: Boolean) = tell(id, "end")
    })
  }

  private fun started(status: Int) {
    val ok = status == TextToSpeech.SUCCESS &&
      tts.setLanguage(Locale.SIMPLIFIED_CHINESE) >= TextToSpeech.LANG_AVAILABLE
    val waiting = synchronized(this) {
      ready = ok
      pending.also { pending = null }
    } ?: return
    if (ok) say(waiting.first, waiting.second) else tell(waiting.first, "no-voice")
  }

  private fun say(id: String, text: String) {
    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
  }

  private fun tell(id: String, event: String) {
    val js = "window.dispatchEvent(new CustomEvent('readerspeech',{detail:{id:" +
      JSONObject.quote(id) + ",event:'" + event + "'}}))"
    webView.post { webView.evaluateJavascript(js, null) }
  }

  /** "ok" speaking, "starting" queued until the engine is up, "no-voice" without Mandarin. */
  @JavascriptInterface
  fun speak(id: String, text: String): String {
    synchronized(this) {
      when (ready) {
        null -> { pending = id to text; return "starting" }
        false -> return "no-voice"
        true -> {}
      }
    }
    say(id, text)
    return "ok"
  }

  @JavascriptInterface
  fun stop() {
    synchronized(this) { pending = null }
    tts.stop()
  }

  fun shutdown() = tts.shutdown()
}
