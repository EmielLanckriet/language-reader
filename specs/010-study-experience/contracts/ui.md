# UI contract

Library shows This week, seven labelled dates, n/5 days, Continue and pending-feedback link.
Progress lists recent sessions, with title/time/activity, optional feedback, saved/error states,
and edit capability. Finish session saves the ending before navigation to /progress?session=id.
No attention modal appears on navigation/pause. Skipping and every grade earn equal participation.

Repository studyOverview(timeZone) returns weeks' activity and recent session summaries, plus latest
available continuation. Existing recordEncounters handles attention writes. No inferred focused label.
