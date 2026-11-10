"""Organize text, pair material references, and import reviewed assignments."""

import json
import re
from collections.abc import Mapping


class BundleError(ValueError):
    """Input or an existing record needs review before the batch can be applied."""


_LABEL = r"[^:\r\n：]{1,40}"
_HEADING = re.compile(rf"({_LABEL})[:：]\s*(.*)")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
_MATERIAL_KINDS = {"audio", "document", "image", "link"}


def organize_sources(sources, labels):
    """Group explicitly labeled text and report lines that need manual review.

    Sources map source IDs to text. Labels map recognized headings to subjects.
    A heading applies to following lines within its source until another heading.
    """
    if not isinstance(sources, Mapping) or not isinstance(labels, Mapping):
        raise BundleError("Provide mappings for sources and labels.")
    subjects = {}
    for label, subject in labels.items():
        name = _text(label).casefold()
        if name in subjects or not re.fullmatch(_LABEL, name):
            raise BundleError("Use unique labels of at most 40 characters without colons.")
        subjects[name] = _text(subject)

    drafts = {}
    review = []
    for source_id, text in sources.items():
        _identifier(source_id)
        if not isinstance(text, str):
            raise BundleError("Each source must contain text.")
        subject = None
        for line_number, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            heading = _HEADING.fullmatch(line)
            if heading:
                label, instructions = heading.groups()
                subject = subjects.get(label.strip().casefold())
                if subject:
                    line = instructions.strip()
            if not subject:
                review.append({"source_id": source_id, "line": line_number, "text": line})
            elif line:
                draft = drafts.setdefault(subject, {"lines": [], "source_ids": []})
                draft["lines"].append(line)
                if source_id not in draft["source_ids"]:
                    draft["source_ids"].append(source_id)
    return {
        "drafts": [
            {
                "subject": subject,
                "instructions": "\n".join(draft["lines"]),
                "source_ids": draft["source_ids"],
            }
            for subject, draft in drafts.items()
        ],
        "review": review,
    }


def _text(value):
    if not isinstance(value, str) or not value.strip():
        raise BundleError("Expected nonempty text.")
    return value.strip()


def _identifier(value):
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise BundleError("Expected an opaque identifier of 1 to 128 characters.")
    return value


def _fields(value, required, optional=()):
    if not isinstance(value, dict) or not required <= value.keys() or set(value) - required - set(optional):
        raise BundleError("Record has missing or unsupported fields.")


def validate_materials(groups):
    """Return ordered material groups containing validated opaque references."""
    if not isinstance(groups, list):
        raise BundleError("Materials must be a list of groups.")
    result = []
    for group in groups:
        _fields(group, {"name"}, {"items", "audio_required"})
        required = group.get("audio_required", False)
        items = group.get("items", [])
        if type(required) is not bool or not isinstance(items, list):
            raise BundleError("Invalid audio flag or material list.")

        checked = []
        for item in items:
            _fields(item, {"kind", "reference"})
            kind = item["kind"]
            if not isinstance(kind, str) or kind not in _MATERIAL_KINDS:
                raise BundleError("Unsupported material kind.")
            checked.append({"kind": kind, "reference": _identifier(item["reference"])})
        if required and not any(item["kind"] == "audio" for item in checked):
            raise BundleError("A material group is missing its required audio.")
        result.append({"name": _text(group["name"]), "audio_required": required, "items": checked})
    return result


def _payloads(entries):
    if not isinstance(entries, list) or not entries:
        raise BundleError("Provide a nonempty list of reviewed assignments.")
    result = {}
    for entry in entries:
        _fields(entry, {"key", "subject", "title", "instructions"}, {"materials"})
        key = _identifier(entry["key"])
        if key in result:
            raise BundleError(f"Duplicate assignment key: {key}")
        payload = {
            "key": key,
            "subject": _text(entry["subject"]),
            "title": _text(entry["title"]),
            "instructions": _text(entry["instructions"]),
            "materials": validate_materials(entry.get("materials", [])),
        }
        result[key] = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return result


def import_assignments(connection, entries, *, apply=False):
    """Preview or atomically insert a reviewed batch in a dedicated SQLite store.

    The caller supplies a connection without an open transaction. Identical keys
    and content are skipped. Reusing a key for different content raises BundleError.
    """
    if type(apply) is not bool:
        raise BundleError("Apply must be explicitly true or false.")
    if connection.in_transaction:
        raise BundleError("Close the existing transaction before importing.")
    pending = _payloads(entries)
    connection.execute("BEGIN IMMEDIATE" if apply else "BEGIN")
    try:
        if apply:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS assignment_bundle_items "
                "(item_key TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assignment_bundle_items'"
        ).fetchone()

        inserted = []
        skipped = []
        for key, payload in pending.items():
            row = None
            if exists:
                row = connection.execute(
                    "SELECT payload FROM assignment_bundle_items WHERE item_key = ?", (key,)
                ).fetchone()
            if row is None:
                inserted.append(key)
            elif row[0] == payload:
                skipped.append(key)
            else:
                raise BundleError(f"Existing content differs for assignment key: {key}")

        if apply:
            connection.executemany(
                "INSERT INTO assignment_bundle_items (item_key, payload) VALUES (?, ?)",
                ((key, pending[key]) for key in inserted),
            )
        connection.execute("COMMIT")
    except BaseException:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    return {"insert": inserted, "skip": skipped}
