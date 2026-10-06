# Battery drain investigation — 2026-10-06

## Report and evidence

The reader reported that the phone suddenly started losing charge very fast, then charged slowly
once attached to the laptop over USB. Evidence is `dumpsys battery` and `dumpsys batterystats`
(summary since last charge, and history) read over adb from the SM-A715F at about 11:00, after it
had been plugged in. Raw dumps remain outside the repository. No settings were changed on the phone.

The last unplug was at 01:34. Over the following 9h06m on battery the screen was on for 57 min.
Android's own estimate was 2526 mAh, but its measured drain was 3432–3520 mAh (capacity 4400 mAh).

| Period (local, approx.) | Level | Rate |
|---|---|---|
| 01:34 → 10:31 | 85% → 28% | steady, ~1% per 10 min |
| 10:43 → 10:55 | 27% → 0% | exactly 1% per ~30.3 s |
| from 10:56 | 0% → 3% | charging from the laptop's USB 2.0 port, laptop itself on battery |

## Finding 1: the sudden drop was a fuel-gauge correction, not real drain

Losing 1% every 30 s would require more than 5 A, which is not a plausible phone load; the evenly
spaced steps are the gauge stepping its displayed level down to the true charge. The voltage agrees:
at a displayed 28% it read 3.61–3.64 V, dipping to 3.48 V under load. That is near empty for this
battery chemistry. The battery calibration date is 2020-07-09, and the gap between measured and
estimated drain fits an aged cell whose gauge overestimates charge. The phone reports health
"good" and ASOC 99%; neither was verified independently.

## Finding 2: the reader service holds a wake lock all night

The largest avoidable cost overnight was `com.termux` (uid 10310):
`termux:service-wakelock` was held for 7h49m on battery, still held at the time of reading.
Android charged it 164 mAh. Suspected, not measured: its real cost is higher, because the CPU
never entered deep sleep (compare global `idle` 246 mAh and `wakelock` 171 mAh). The holder was
`python3 ~/bin/reader-service.py` under `bash -l`. That process used only 33 s of CPU, so the
service itself was idle; the wake lock alone kept the phone awake.

This is by design: `scripts/termux/setup.sh`, `reader-service-up` and `termux-url-opener` call
`termux-wake-lock` because Termux keeps a service alive only while it holds the lock (ADR-0020's
amendment). The design therefore trades continuous drain for availability.

Re-read at about 11:30 (read-only): the lock was still held (`ACQ=-9h35m`), Termux's service is a
foreground service and already on the Doze whitelist, and the reader service still had 33 s of CPU.
`termux-wake-lock` also takes a Wi-Fi lock: `dumpsys wifi` lists `WifiLock{termux type=3}` (high
performance, work source uid 10310), so Wi-Fi stays out of power saving while the wake lock is held.
Its cost is not in Android's 164 mAh for the wake lock; not measured.

Other consumers, for context and not caused by Reader: YouTube about 530 mAh (about 40 min of
watching over Wi-Fi), always-on display 204 mAh, Play Store and Google services about 90 mAh.

## Open questions and next steps

- Decide whether the service must be reachable at all times. Options: take the wake lock only
  while a job (translation, download) is running and release it when idle; or let Reader Start
  bring the service up on demand instead of keeping it alive from boot. Either needs a check that
  Android does not freeze or kill the idle service (the failure ADR-0020's amendment fixed).
- Measure the idle cost directly: a night with the service running but the wake lock released,
  compared with this one (about 6%/h with the screen mostly off).
- Battery: charge fully once from a wall charger so the gauge can recalibrate. If drops like this
  one recur near the low end, the cell is likely worn, independent of Reader.
