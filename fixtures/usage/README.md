# Usage source test fixtures

These are small **test fixtures**, not articles for publication. They were reduced
offline from the saved research responses captured on 2026-11-26. Article bodies
are shortened to approximately 180 characters, so these copies intentionally do
not meet the publication length requirements. Dates, titles and reaction fields
remain representative of the saved response schema. No production source was
queried to create these fixtures.

| Files | Saved research input |
| --- | --- |
| `features.json` | Three short saved Zenn/Qiita/English paragraphs and their exact Python feature vectors; fixture provenance is recorded per case |
| `zenn-list.json`, `zenn-article.json` | `research-zenn-73027ee36796dc.json`; list shape from `research-zenn-list-codex-1.json` |
| `qiita-list.json` | One AI item from `research-qiita-list-1.json` |
| `hatena.xml` | One item from `jp-source-hatena-it-rss.json`; descriptions removed |
| `note.html` | Metadata and a short paragraph from `jp-source-note-article-n35d0bb54e6fb.json` |
| `hn.json`, `hn-article.html` | HN 50526152 from `en-hn-all.json` and `en-body-candidates.json` |
| `simon-entries.xml` | Long-form entry metadata from `en-raw-simon-feed.json`; its shortened HTML summary is explicitly converted to a synthetic Atom `content` element for parser tests |
| `hatena-count.json`, `robots.txt`, `manifest.json` | Synthetic small count/robots/URL-routing controls for deterministic tests |

The saved Simon research response was `/atom/everything/`, **not** evidence of
the live `/atom/entries/` response. The synthetic fixture tests the accepted
entries-feed contract. Production requests only `/atom/entries/`, and retrieves
the original public article when a feed offers only a summary. Tests separately
verify that a summary alone is never treated as a complete body.

The manifest intentionally repeats a small list across topics and HN time
slices. Dedicated tests exercise pagination, truncation and request budgets.
An unmapped fixture request fails locally and never falls back to the network.
