# Quickstart: Checking That Work Survives A Wipe

Every check here takes about a minute. See the memory rule on short fixtures and
[scripts/android-emulator/README.md](../../scripts/android-emulator/README.md) for the emulator.

## Unit (laptop)

```sh
npx vitest --run tests/backup
```

What must hold, and has each been made to fail once:

- **Round trip**: for generated histories (random marks across random documents and devices),
  export → restore into an empty store gives identical events, identical states, identical documents.
- **Tamper and truncate**: flipping one character or cutting the file makes restore refuse, and the
  store is byte-for-byte unchanged.
- **Non-empty refusal**: with any earned record present, restore refuses and writes nothing.
- **Formats**: every `tests/fixtures/copies/format-*.json` restores.

## Service (laptop)

```sh
python3 scripts/termux/reader-service.py --root /tmp/reader-service &
curl -s 127.0.0.1:8765/health
curl -s -X PUT --data-binary @tests/fixtures/copies/format-1.json 127.0.0.1:8765/backup -o /dev/null -w '%{http_code}\n'   # 204
curl -s 127.0.0.1:8765/backup/latest | head -c 80
```

## The wipe (emulator, via the harness)

With the service running on the laptop and `adb reverse tcp:8765 tcp:8765`:

```sh
node scripts/verify-in-browser/harness.mjs wipe --cdp 9333 --app https://emiellanckriet.github.io
```

It marks two words in the sample text, waits for the copy (the scenario shortens the 30 s delay),
clears the site's data through DevTools, reloads, accepts the offered restore, and checks both
marks and their history. Expected: `pass: true` in about a minute.

## Warnings (emulator, by eye)

- In a Chrome tab: "not installed" warning.
- With the service stopped: "copy is stale" after the bound (the scenario can shorten it).
- Installed, protected, service running: nothing shown. Untestable until the emulator has a Google
  account (docs/backlog.md).
