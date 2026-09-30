# Data model
AnkiExample: key (profile/note ID), word, text, translation, pinyin, original fields, optional
wordAudio/sentenceAudio SHA-256 file identities. Imported encounter adds profile/source title and
content hash for idempotence. Existing encounter format/backups preserve it without migration.
CardSentence: source type/label/key, text and code-point word offsets; Reader variants include
source document/range/line and availability, Anki variants include audio references/translation.
A review may include exampleKey in detail; absent for old reviews, no invented historical identity.
Audio is derived/recoverable from retained source bundle and stored separately from the logical
backup. Missing clips do not hide the retained example; reimport repairs files without duplicating facts.
