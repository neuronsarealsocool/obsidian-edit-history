# 0.4.0 — External backup directories

Fork release, 23 November 2026, based on Antonio Tejada's Edit History.

Adds **External backup directory** to settings. Enter an absolute Windows directory or UNC network path and click **Apply**. The plugin creates and checks the directory, then saves this vault's history into a separate subfolder. The current full location is displayed in settings.

Use **Copy history** before editing notes at the new location to copy existing vault `.edtz` archives without deleting originals or overwriting existing destination archives. Leave the directory blank and apply to return to vault storage.

- Keeps the existing history viewer and compressed `.edtz` format.
- Supports external history reads, writes, note and folder renames, and deletions.
- Prevents collisions between vaults sharing the same backup directory.
- Serializes archive updates and replaces external archives using a temporary file.
- Reports storage errors without silently falling back to vault storage.
- Removes upstream's automatic copying into installed vaults during builds.
- Includes seven automated filesystem and simulated Obsidian integration tests.

External paths require desktop Obsidian. Deleting a note deletes its active history, following the upstream behavior. Moving the vault itself changes its storage subfolder identity; see the README for preserving history when relocating a vault.

## Installation

For an existing installation, disable Edit History and close that vault window, back up `.obsidian/plugins/edit-history`, then replace only `main.js`, `manifest.json`, and `styles.css` using the install zip. Keep `data.json` and existing `.edtz` files. Reopen Obsidian and enable **Edit History (External Backups)**. Repeat in each vault.

BRAT repository: `neuronsarealsocool/obsidian-edit-history`. The release includes the three direct assets required by BRAT. The fork keeps plugin ID `edit-history`, so it replaces the original rather than running alongside it.

The **install zip** contains the ready-to-use plugin folder. The **AI-ready full-folder zip** additionally contains source, tests, build configuration, lockfile, and license; no private runtime data or dependencies are included.

Validation: `npm test` passes all seven tests, including real Windows filesystem operations, revision reconstruction, simulated settings and history viewer flows. No live vault installation was modified during validation.
