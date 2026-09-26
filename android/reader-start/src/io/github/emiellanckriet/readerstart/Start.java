package io.github.emiellanckriet.readerstart;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Asks Termux to run ~/bin/reader-service-up through its RUN_COMMAND service, then closes, which
 * leaves the reader where they were: in Reader. The script runs as a background task that hosts
 * the service, so Termux keeps it alive (ADR-0020's amendment). Termux must allow it:
 * allow-external-apps = true in ~/.termux/termux.properties, which setup.sh sets.
 */
public class Start extends Activity {
	private static final String PERMISSION = "com.termux.permission.RUN_COMMAND";
	private static final String SCRIPT = "/data/data/com.termux/files/home/bin/reader-service-up";

	@Override
	protected void onCreate(Bundle state) {
		super.onCreate(state);
		if (checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED) run();
		else requestPermissions(new String[] {PERMISSION}, 1);
	}

	@Override
	public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
		if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) run();
		else {
			Toast.makeText(this, "Reader Start needs permission to run Termux commands.", Toast.LENGTH_LONG).show();
			finish();
		}
	}

	private void run() {
		Intent intent = new Intent("com.termux.RUN_COMMAND");
		intent.setClassName("com.termux", "com.termux.app.RunCommandService");
		intent.putExtra("com.termux.RUN_COMMAND_PATH", SCRIPT);
		intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
		try {
			startForegroundService(intent);
		} catch (RuntimeException error) {
			Toast.makeText(this, "Could not reach Termux: " + error.getMessage(), Toast.LENGTH_LONG).show();
		}
		finish();
	}
}
