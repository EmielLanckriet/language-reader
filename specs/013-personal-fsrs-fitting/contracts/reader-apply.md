# Contract: applying, rolling back and fitting in Reader

## Cards → Learning data

- **Import fitted set**: reads a `ParameterSet` file and shows its report beside the active set.
- **Apply** is enabled only when the report says `applicable` and its `comparedWith` equals the
  active set's id. Otherwise the button is replaced by the reason: "did not predict better",
  "too little data", or "fitted against a different set — fit again".
- **History**: every activation, newest first, each with **Return to this set** (always allowed).
- Applying or returning appends one `fsrs-activation`; memory updates in the background and the
  page says so until the sweep has finished.

## Fit (Story 4)

- **Fit on this phone**: runs the same fit as `fit.mjs` over the same export in a dedicated
  worker under the local-model lease; shows progress and **Cancel**.
- Stops on cancel, when the app is hidden, at a 5-minute deadline, or when the lease is refused;
  a stopped fit leaves nothing behind.
- A finished fit shows the same report and the same Apply rule as an imported file.

## Word sheet

- **Undo tap** (while the sheet is open): closes the sheet, writes `tap-undone`, no lookup.
- The "I knew it" button is removed. Choosing a status keeps working as today.
