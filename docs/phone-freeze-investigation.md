# Phone freeze investigation — 2026-09-29/30

## Report and evidence

The reader reported that using the app made the phone very hot and unresponsive, including failed
restart attempts. It recovered after the battery ran out. The exact preceding app action has not
yet been supplied. No attempt was made to reproduce the freeze on the phone.

On reconnect, the SM-A715F reported approximately three minutes uptime, 4% battery and 31.3°C.
The boot reason was `reboot,lpm`. Surviving last-kernel entries covered the low-power restart, not
the earlier incident; they do not establish an OOM, thermal shutdown, or offending process.
The stored lifetime maximum battery temperature is not an incident temperature and is not used
as evidence of this freeze. The CPU snapshot covered boot and cannot identify earlier app load.
No running llama or translate.py process was seen in the inspected process listing.
Raw system logs remain outside the repository because they can contain unrelated device details.

Existing Android phantom-process overrides were still present (monitor disabled, maximum
2147483647). They were not introduced by this incident fix and have not been reset silently.
The USB stay-awake setting from our earlier check was restored to 0.

## Confirmed code defects and fixes

1. Termux used per-video PID markers, allowing distinct videos to infer simultaneously. A two-job
   fake-model regression observed two concurrent calls before the fix and one after it. A shared
   file lock now serializes invocations and resource checks occur inside it. Running inference is
   supervised for memory pressure, Reader activity and timeout; the child is killed and reaped.
2. Browser speech and quick translation did not terminate on page hiding. Both now terminate and
   resume from retained results. Speech loading cancellation settles its waiting promise too.
3. Speech and quick translation could load concurrently across Reader tabs. Their worker lifetimes
   now share a Web Lock, released on termination and when idle. Automatic calibration is removed
   from setup; speech uses one thread.
4. The audio-resume probe used in our prior session left its worker alive after completion and had
   no page-level stop/deadline. It now requires Start and terminates on hide, finish, error or timeout.
   The recorded earlier runs completed; this cleanup defect does not prove they caused the freeze.

Working hypothesis: resource exhaustion from overlapping inference is plausible. It is NOT an
established root cause of the whole-device failure. A PWA update alone does not update Termux.

## Validation and remaining work

Regressions cover concurrent Termux jobs, forced termination under memory pressure, speech
cancellation during loading, and quick translation hide/resume/timeouts. The concurrency test
failed on the original code; mutation checks confirmed the cancellation/termination tests detect
removal of their safeguards. No real models are run by those tests.

Still needed: install both components, verify installed versions, then plan a short isolated device
check after charging and cooling. Existing old tabs must be closed/reloaded to gain these fixes.
Model memory consumption for long videos, contextual segmentation concurrency, and sustained
thermal behavior remain unmeasured. The changed limits reduce exposure but cannot certify that
another phone freeze is impossible. See [ADR-0032](adr/0032-bound-phone-inference.md).

## Installing the Termux part

In Termux, after the repository update is published:

```sh
curl -fsSL https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux/update-translation.sh | bash
```

This updates only `~/bin/translate.py`, retains the previous script as
`~/bin/translate.py.before-resource-fix`, and does not launch a model. It refuses to replace a
running translation. Do not rerun the full setup script just for this patch.

Local validation: 424 app tests and 9 Termux tests passed. Type checking and a production build
passed; phone installation and a bounded device check remain separate from these results.
