# AP👁️Spy — SpecRecon DevTools Extension

AP👁️Spy is the DevTools observer for **SpecRecon / SpeQL**.  
It adds a custom panel to Chromium-based browser developer tools that watches outgoing network requests and cross-references them against the bundled SpecRecon API inventory.

---

## What does it do?

For every Azure/Microsoft API request observed in the DevTools network inspector, APISpy classifies the request into one of five states:

| Status | Meaning |
|---|---|
| ✅ **Exact match** | Host + method + path template + `api-version` exist in the bundled index |
| ⚠️ **Version mismatch** | Route found, but the requested `api-version` is not in the spec |
| 🔶 **Unknown route** | Provider namespace is known; route not found in bundled shard |
| ❌ **No spec match** | No provider namespace inferred, or provider shard not bundled |
| — **Out of scope** | Request does not appear to be Azure/Microsoft API traffic |

---

## Architecture

```
apispy/
├── extension/          ← The unpacked Chrome extension directory
│   ├── manifest.json   ← MV3 extension manifest
│   ├── devtools.html   ← DevTools page entry point
│   ├── devtools.js     ← Registers the APISpy panel
│   ├── panel.html      ← Panel UI markup
│   ├── panel.js        ← Panel logic: observation, rendering, filtering
│   ├── panel.css       ← Panel styles
│   ├── lib/
│   │   ├── filters.js      ← In-scope heuristics (host/URL based)
│   │   ├── normalizer.js   ← Extracts & normalises request fields
│   │   ├── loader.js       ← Lazy-loads provider shards from bundled data
│   │   └── matcher.js      ← Classifies requests against the index
│   ├── data/
│   │   ├── manifest.json   ← Lists bundled shards + source metadata
│   │   └── shards/         ← Per-provider minified JSON shard files
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── scripts/
│   └── prepare_data.py     ← Extracts shards from the SpecRecon zip export
└── tests/
    ├── test_filters.js
    ├── test_normalizer.js
    └── test_matcher.js
```

---

## How to load in Chrome / Edge

1. Open **chrome://extensions** (or **edge://extensions**).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `apispy/extension/` directory.
5. Open DevTools on any page (**F12** or right-click → *Inspect*).
6. You should see a new **APISpy** tab in the DevTools panel bar.
7. Browse to a page that makes Azure/Microsoft API calls and watch results appear.

---

## How the static bundled index works

The extension ships with pre-extracted shard files in `data/shards/`.  
These are `.min.json` files derived from the SpecRecon grouped/sharded export
(`api-index-grouped.json`, schema 3.0.0), one file per Azure provider namespace.

A top-level `data/manifest.json` is read once on startup.  When a request arrives
for a provider like `Microsoft.Storage`, only the `Microsoft.Storage.min.json`
shard is fetched — nothing else is loaded.

Shards larger than 50 KB (minified) are **not** bundled in the repository to keep
the extension directory a manageable size.  The bundled shards cover 169 providers.

### Adding more shards

To include all 302 available shards (including larger ones):

```bash
# From the repository root — requires the sharded zip in inventory/
python3 apispy/scripts/prepare_data.py --all
```

To re-populate from a fresh export:

```bash
python3 apispy/scripts/prepare_data.py --zip inventory/api-index-sharded-<run-id>.zip
```

After running, reload the unpacked extension in Chrome to pick up the new data.

---

## Running the tests

The unit tests for `filters`, `normalizer`, and `matcher` run in Node.js (no
additional packages required).

```bash
# From the repository root
node apispy/tests/test_filters.js
node apispy/tests/test_normalizer.js
node apispy/tests/test_matcher.js
```

---

## v1 known limitations

- **Path template matching is conservative.**  
  The normalizer only replaces GUID-shaped path segments (`{guid}`) and pure
  numeric IDs (`{id}`).  Arbitrary resource names (e.g. `myStorageAccount`) are
  not mapped to spec path template parameters in v1.  This means most ARM routes
  will appear as *Unknown route* or *No spec match* even when the provider shard
  is bundled.  Improving the template-matching heuristic is the primary v2 task.

- **Providers with large shards are not bundled.**  
  133 providers (e.g. `Microsoft.Compute`, `Microsoft.Network`) have shards
  larger than 50 KB and are excluded from the repository bundle.  Run
  `prepare_data.py --all` to include them locally.

- **No background sync.**  
  The bundled index is a point-in-time snapshot.  There is no automatic update
  mechanism in v1.

- **Graph and non-ARM APIs.**  
  `graph.microsoft.com` is recognised as in-scope, but the bundled index currently
  covers Azure Resource Manager (`management.azure.com`) exclusively.

---

## Future planned enhancements

1. **Better path template matching** — fuzzy segment matching against spec templates.
2. **Remote artifact updates** — pull latest shards from GitHub Pages / artifact store.
3. **Full shard bundle** — serve large shards on demand rather than bundling all.
4. **Graph API support** — add Microsoft Graph spec shards.
5. **Export timestamp display** — show index freshness in the panel.
6. **Filter persistence** — remember the last-used filter across panel opens.

---

## Relationship to SpecRecon / SpeQL

- **SpecRecon** — the repository and export pipeline that produces the API inventory.
- **SpeQL** — the query engine used to analyse the Azure REST API spec corpus.
- **APISpy** — this extension; the DevTools consumer of the SpecRecon static export.

APISpy does **not** modify the SpecRecon export pipeline.  It consumes the
already-produced output files.
