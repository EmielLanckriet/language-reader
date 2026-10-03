package io.reader.translationbench;
import android.app.Activity;
import android.os.Bundle;
import android.os.Debug;
import android.widget.TextView;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.translate.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
 TextView status;
 public void onCreate(Bundle state) {
  super.onCreate(state); status = new TextView(this); status.setText("Starting benchmark"); setContentView(status);
  new Thread(() -> runBenchmark()).start();
 }
 void save(String name, String data) throws Exception {
  try (java.io.FileOutputStream out = openFileOutput(name, MODE_PRIVATE)) { out.write(data.getBytes(StandardCharsets.UTF_8)); }
 }
 void runBenchmark() {
  Translator translator = null;
  try {
   long baseline = Debug.getPss();
   translator = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage("zh").setTargetLanguage("en").build());
   if (getIntent().getBooleanExtra("download", false)) {
    Tasks.await(translator.downloadModelIfNeeded(new DownloadConditions.Builder().build()), 8, TimeUnit.MINUTES);
    save("download.json", "{\"ready\":true}");
   } else {
    String input;
    try (java.io.InputStream in = getAssets().open("corpus.json")) { input = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
    JSONArray corpus = new JSONArray(input), rows = new JSONArray();
    for (int round=0;round<2;round++) for(int i=0;i<corpus.length();i++) {
     JSONObject item=corpus.getJSONObject(i);
     long start=System.nanoTime();
     String translated=Tasks.await(translator.translate(item.getString("text")), 30, TimeUnit.SECONDS);
     rows.put(new JSONObject().put("id",item.getString("id")).put("round",round).put("translation",translated).put("ms",(System.nanoTime()-start)/1e6).put("pss_kib",Debug.getPss()));
     save("results.json",new JSONObject().put("engine","ML Kit 17.0.3").put("baseline_pss_kib",baseline).put("rows",rows).toString(2));
    }
   }
   runOnUiThread(() -> status.setText("Complete"));
  } catch(Exception e) {
   try { save("error.txt", e.toString()); } catch(Exception ignored) {}
   runOnUiThread(() -> status.setText(e.toString()));
  } finally { if(translator != null) translator.close(); }
 }
}
