# Verification

Run focused study/recorder/encounter/backup tests, npm run check and scoped lint.
Build verification mode; use disposable browser/service origin as in scripts/verify-in-browser/README.md.
Seed only synthetic short histories there. Check Finish→summary→answer→reload→edit and weekly
credit equality for grades. View 390px light/dark screenshots. Physical-phone/deployment validation
is separately recorded and cannot be inferred from an emulator or laptop result.

## Results — 2026-09-30

- 34 focused tests across seven files passed (study domain/storage, recorder, encounters, memory,
  backup format 2 and domain purity).
- Six deliberate mutations were detected: grade-biased credit, wrong week boundary, invalid
  duration acceptance, hidden reading credit, withdrawn-session inclusion and ignoring playback speed.
- Browser testing found interval clock drift just below the minute threshold; the clock-read
  regression failed before the fix and passes with one captured time per interval.
- Type checking reports zero errors/warnings; scoped ESLint and Prettier checks passed.
- Verification build passed, including bundle checks.
- Disposable `study` browser scenario passed: one study day, saved feedback survives reload,
  correction succeeds, and document/viewport width both 390px. Saving now preserves expanded
  session details, after the browser scenario exposed their premature collapse.
- Light/dark Progress and light Library screenshots visually inspected; readable at 390px.
  The uninstalled test browser shows installation/backup warnings, and full-page captures put the
  fixed tab bar at the original viewport bottom. Those are expected capture/environment effects.
- No attached device was reported by adb at the final check. Deployment and installed physical-phone
  validation remain pending; no synthetic activity was written to the daily reader.

## Phone delivery — 2026-09-30

Commit `4786e13` deployed successfully in GitHub Actions run `36719898322`; CI passed full lint,
type checking, 439 tests and production build. Published and installed running build, plus active
service worker, matched `1790773958309` on Samsung A71. Standalone Library/Progress rendered at
411px without overflow. Existing sessions remained visible; no answers were submitted there.
The synthetic `study` scenario separately passed on the isolated phone origin with its disposable
service: one credited day and feedback corrected after reload. Desktop CDP full-page captures on
Android repeated content; installed viewport captures and the physical screen were inspected instead.
No model benchmark ran. Temporary USB mappings/services were removed and screen-awake setting
restored to 0. The installed app was left on Library.
