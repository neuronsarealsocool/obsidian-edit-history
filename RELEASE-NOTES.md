# 0.5.1 — Preserve desktop patch chains during Android imports

27 November 2026.

Fixes the “Existing history could not be reconstructed; archive preserved” error caused by independent Android snapshots interleaving with desktop backward patches, including versions saved in the same second.

- Reconstruct desktop patches from the desktop chain while retaining every Android before/after snapshot.
- Use the same validated reconstruction for the importer, history viewer, and timeline.
- Keep Android full snapshot names and event IDs intact when a later desktop save is compressed, preventing repeat imports and lost snapshot identities.
- Keep genuinely unreconstructable archives unchanged, leave their mobile records pending, and identify the failed entry in the error.
- Reject conflicting snapshot names instead of overwriting an older version.

No note text or plugin settings are changed by the update. The importer can process affected, recoverable archives using their original patches; the archive format remains compatible with existing releases.

Validation: TypeScript production build and all 11 tests pass, including same-second import/viewing, desktop saves after mobile imports, restart idempotence, and byte-for-byte preservation of genuinely broken archives.

BRAT repository: `neuronsarealsocool/obsidian-edit-history`. Release assets include direct `main.js`, `manifest.json`, and `styles.css`, an install zip, and an AI-ready full-folder source zip.
