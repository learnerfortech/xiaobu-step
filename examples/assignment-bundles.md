# Assignment bundles

`tools/assignment_bundles.py` is a standalone Python library for organizing text by explicit subject labels, validating grouped material references, and importing reviewed entries. It uses Python's standard library. The existing application would need an adapter to consume this format. The importer writes its own SQLite table, so pass it a connection to a dedicated store.

Run this example from the repository root with Python 3.9 or later. It uses synthetic input and an in-memory database.

```python
import sqlite3
from contextlib import closing

from tools.assignment_bundles import import_assignments, organize_sources

drafts = organize_sources(
    {"sample": "M: Add 2 and 3.\nCheck the result."},
    {"M": "Math"},
)
assert not drafts["review"]

entry = {
    "key": "demo-1",
    "subject": drafts["drafts"][0]["subject"],
    "title": "Practice addition",
    "instructions": drafts["drafts"][0]["instructions"],
    "materials": [{
        "name": "Exercise",
        "audio_required": True,
        "items": [
            {"kind": "document", "reference": "sheet-1"},
            {"kind": "audio", "reference": "clip-1"},
        ],
    }],
}

with closing(sqlite3.connect(":memory:")) as db:
    print(import_assignments(db, [entry]))               # Preview, no writes.
    print(import_assignments(db, [entry], apply=True))   # Inserts demo-1.
    print(import_assignments(db, [entry], apply=True))   # Skips demo-1.
```

Review lines returned in `review` before building the import entries. An explicit heading uses a colon, including `：`, and applies to subsequent lines within the same source until another heading. Unknown headings are returned for review and reset the current subject. Draft instructions omit the heading and trim surrounding whitespace. Use the returned source IDs to look up the original text.

Material references are opaque identifiers supplied by the caller. The library preserves group and item order and checks that required audio belongs to the same group. It does not resolve references or open files.

An import returns the keys to insert and skip, in input order. Reuse the same keys to retry. If an existing key has different content, the import raises `BundleError` and leaves the batch unapplied.

To run the synthetic checks:

```sh
python3 -m unittest discover -s tests -v
```
