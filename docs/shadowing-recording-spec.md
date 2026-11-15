# Shadowing Recording Feature Spec

## Problem
Users want to practice shadowing (speaking in sync with native speakers) and record their attempts to review and measure improvement. Current workflow requires exporting audio files and managing them separately.

## Desired Feature

### User Goals
- Toggle recording mode on/off (persist preference)
- Record their voice while a sentence/line plays
- Play back their recording to hear how close they were
- No permanent storage needed (listen-once-and-discard)

### Flow

#### Entry point
- In stage view (full screen), open the ⋯ menu
- Toggle "Recording for shadowing" on/off
- Setting persists across sessions

#### Recording a line
When recording is enabled, a record button (⭕) appears on the right side of the stage (opposite the playback controls).

1. User taps the record button → recording starts
2. User manually plays the sentence using existing play controls (◀ ↻ ▶ or click the line)
3. User shadows along with the audio
4. When audio ends (or user pauses), recording stops
5. A "play recording" button (▶) appears next to the record button
6. User can tap it to play back their recording and hear their performance
7. User moves to next sentence → "play recording" button disappears, record button is ready for the next line

#### Edge cases to handle
- **Moving to next line**: "Play recording" button disappears, record button is ready for the new line
- **Pausing mid-sentence**: Recording stops (partial recording captured)
- **Tapping record again mid-recording**: Discard current recording and start fresh?
- **Permission denied**: Gracefully handle if user denies microphone access (show error, don't hang)
- **No audio track**: Record button should still appear (user can record silence for testing)
- **Seeking/jumping lines**: Treat like moving to next line (discard recording)

## Technical Constraints

### Current app architecture
- MediaReader.svelte handles playback UI and line management
- Recorder class tracks session encounters and interactions
- localStorage used for user preferences
- Phone app is native Android (Tauri + WebView)

### Must work on
- Chrome desktop (dev testing)
- Firefox desktop
- Android WebView (native app on phone)
- Handle microphone permission gracefully

### Should NOT do
- Store recordings permanently
- Send audio anywhere
- Record in background
- Auto-start recording on every line

## Open Questions

1. **Recording button position**: Right side with EN/speed buttons? Or somewhere else?

2. **Visual feedback**: How to clearly show recording is active? (⭕ recording, ▶ play recording?)

3. **Tapping record button again**: If recording is already active, does tapping it again discard and start fresh, or do nothing?

4. **Error display**: If microphone permission is denied, where/how to show the error?

## Success Criteria

- User can enable/disable recording mode (menu toggle, persists)
- Record button (⭕) appears only when enabled and recording is not active
- Tapping record button starts recording (no auto-play)
- Recording stops when audio ends or is paused
- "Play recording" button (▶) appears after recording stops
- Tapping play button lets user hear their recording once
- Moving to next line/sentence hides play button and resets record button
- No microphone permission hang (show error gracefully)
- Works on phone WebView
- No stored recordings (memory clean after user leaves the line)

## Not in scope (for now)

- Saving recordings
- Comparing recordings
- Analyzing pronunciation differences
- Integration with spaced repetition
- Mobile-specific optimizations beyond what exists
