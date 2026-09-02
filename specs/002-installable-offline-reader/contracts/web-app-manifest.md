# Contract: Web App Manifest

**File**: `static/manifest.webmanifest` — served at `<base>/manifest.webmanifest`
**Referenced from**: `src/app.html`, as `<link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest" />`

This is a contract with the device's installer, not with our own code. Every member below is
present because something depends on it; nothing is present for completeness.

```json
{
  "name": "Language Reader",
  "short_name": "Reader",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Why each member is here

| Member | Requirement | Note |
|---|---|---|
| `name`, `short_name` | FR-003 | The home-screen label. `short_name` is what Android actually shows. |
| `start_url` | FR-002 | **Must stay relative.** Resolves against the manifest's URL, so `./` is `/language-reader/` when deployed and `/` locally. An absolute `/` launches the installed app at the domain root and shows a missing page. |
| `scope` | FR-001 | Relative, for the same reason. Navigations outside scope open in a browser, which would undo the standalone window mid-session. |
| `display: standalone` | FR-001, SC-002 | The member that removes the address bar. |
| `icons` 192 + 512 | FR-003, FR-003a | A manifest without both does not qualify for installation, so their absence silently disables the install offer. |
| `purpose: maskable` | FR-003 | Android crops to the launcher's shape. Without it, the icon gets a white bounding box. |

## The invariant a test can hold

**No manifest member URL may begin with `/`.** This is one assertion over the parsed file, and it
is the whole of R3's finding made permanent. It is worth a test rather than a comment because the
failure it prevents is invisible in development — the base path is empty locally, so an absolute
`start_url` works perfectly right up until it is deployed.
