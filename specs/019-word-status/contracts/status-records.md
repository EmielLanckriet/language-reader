# Contract: status records

Settled before the first row (Principle V).

## A status change

- `status` ∈ {`retired`, `active`, `ignored`}; anything else is refused on write and on restore.
- `cause` ∈ {`reader`, `stable`, `first-review`, `carried-over`}; refused otherwise.
- `active` with cause `reader` only as an Undo of a Retire or the return from an ignore (FR-014);
  `stable` and `first-review` only with status `active`; `carried-over` only by the switch.
- Written in one transaction with its device counter and the `word_status` update; the log first.

## Replay

`word_status` = for each word, the status of its latest change in `(device_id, device_seq)` order.
Exporting refuses when they differ; restoring replays and refuses a copy whose statuses do not
match its own log.

## Copy (format 4)

```json
"statuses": [
  { "deviceId": "…", "deviceSeq": 32600, "language": "zh", "surface": "丁",
    "status": "retired", "cause": "reader", "at": "2026-10-20T08:00:00.000Z", "userId": 1 }
]
```

A format 1–3 copy reads as `statuses: []` and runs the switch on restore.

## The switch

At most once per library, recognised by its `status-switch` encounter. Deletes marks asserting
`ignored`, `learning`, `known`, `unknown`, `retired`, and a `(none)` whose word's previous mark was
one of those; keeps Anki levels and every other `(none)`. Writes `active` / `carried-over` for every
word active under the old rule. All in one transaction with the encounter.
