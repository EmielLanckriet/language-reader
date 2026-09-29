# ADR-0032: Bound phone inference and stop hidden workers

Date: 2026-09-30. Status: accepted for incident containment; thermal validation pending.

## Problem

The reader reported a hot, unresponsive phone that recovered only after battery depletion.
Surviving logs do not identify the offending process. Code inspection and a failing regression
showed that different Termux video jobs could load separate large translation models together.
Browser speech and quick translation also continued while hidden. Automatic speech calibration
could run six model-loading trials on startup. See [incident notes](../phone-freeze-investigation.md).

## Decision

- Serialize Termux model invocations across videos with an OS file lock. Check memory and Reader's
  busy marker after obtaining it; refuse to infer when memory availability cannot be measured.
  Use one thread. Supervise the child every two seconds: kill/reap on low memory, Reader becoming
  busy, or a three-minute deadline. Unfinished source tracks remain available for a later retry.
- Speech and quick translation share an origin-wide Web Lock for their worker lifetime. Terminate
  workers and abort queued leases when the page hides. Resume from saved results on returning.
  Release a speech lease when pacing waits; release quick translation when no lines are available.
- Stop automatic calibration and use one speech thread. Bound speech loading, individual speech
  windows, quick model loading, and individual quick lines. These are conservative limits, not
  measurements establishing a safe thermal envelope.
- Measurement pages require an explicit start and terminate their worker on completion, failure,
  hiding, or deadline. Do not run heavy phone measurements during this incident.

The cost is slower transcription and English waiting behind speech. We prefer that to simultaneous
large model workloads. Browser locks are per origin; they cannot coordinate an old app build, a
separate test origin, or Termux directly. Termux uses the existing busy heartbeat plus supervision.
The contextual segmenter is not covered by the speech/quick worker lock; moving it off the main
thread and budgeting all inference remains follow-up work. Do not call this a proven freeze cure.

## Alternatives

Raising Android process limits or repeating the workload on the user's phone would not establish
safe resource bounds. Raising the initial memory threshold alone leaves the concurrent-start race
and later memory pressure intact. Disabling all learning functionality would unnecessarily affect
reading and preserved history; the changes target the expensive processing paths.
