# Feature Specification: Spoken stories

**Created**: 2026-10-16 · **Status**: Built · **Input**: the reader, after #10's stories: "Does the
text have TTS?" No; build a generated audio track so a story plays in the player like a video
(listening counts, line by line), with the voice the reader chose by ear: MeloTTS.

## User Scenarios & Testing

### User Story 1 - Listen to a story (P1)

On a shown story, **Listen to it** asks Termux to speak it. The page says how far it is (speaking,
n %); when ready the story is imported and its page opens; Play opens it in the player, one
subtitle line per sentence, with English following as for a download. Leaving the page leaves the
spoken story under New from Termux.

**Acceptance**: (1) the document plays with one cue per sentence, each cue covering its sentence's
speech; (2) the history records nothing until the reader plays it, then as for any video; (3) a
failure says why under New from Termux and on the page.

## Requirements

- **FR-001**: Reader splits the story into sentence lines (closing punctuation and quotes kept) and
  sends them with a title to the Termux service (`POST /speak`, contracts/speak.md).
- **FR-002**: Termux speaks them with MeloTTS on the phone, never beside a translation or story
  (the model lock) and not while Reader transcribes; it encodes AAC, writes `media.zh.vtt` from the
  measured sentence times, and packs `bundle.tar` with `meta.json` like a download.
- **FR-003**: Progress is reported as a download's (`progress.json`: speaking with percent, waiting,
  packing, failed with reason).
- **FR-004**: Reader imports the bundle with the existing import; no new document kind.

## Success Criteria

- **SC-001**: A ~230-character story is ready on the phone within 2 minutes (measured: 59 s to speak
  41 s of audio, 375 MB peak, 338 KB of AAC).
- **SC-002**: The voice is MeloTTS (the reader's choice, 2026-10-16), 4.9 % of characters misheard
  by SenseVoice on the laptop, 6.0 % on the phone's audio.

## Research (laptop and phone, 2026-10-16; scripts/measure/tts/compare.py)

| voice | laptop time for 45 s | clarity (misheard) | size |
| --- | --- | --- | --- |
| matcha-zh-baker | 2.2 s | 3.8 % | 124 MB |
| **MeloTTS zh-en (chosen)** | 9.8 s | 4.9 % | 170 MB |
| Kokoro v1.1 | 18.3 s | 7.6–8.2 % | 330 MB |

The phone runs a static sherpa-onnx build (scripts/termux/tts/build-tts.sh, 21.7 MB) with a small
C program that loads the model once and prints each sentence's times; 4 threads were no faster than
2. ffmpeg build 2 adds AAC encoding; its video merge stayed byte-identical. ffmpeg needs `-nostdin`
in scripts: it read the rest of a piped script as keyboard commands.
