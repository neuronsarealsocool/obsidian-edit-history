# Obsidian Edit History — External Backups fork

## Offline catch-up and Android recording (0.5.0)

Eligible notes are reconciled at startup, and the [standalone Android Note Version Recorder](https://github.com/neuronsarealsocool/note-version-recorder) can supply intermediate saved versions through Resilio Sync. Historical imports reconstruct existing backward patches before inserting full snapshots, preserving old history. Repeated journal events are ignored. This release also supports long Windows note titles and schedules a trailing save after throttled edits. See [setup and limitations](OFFLINE-HISTORY.txt).

This fork of [Antonio Tejada's Edit History](https://github.com/antoniotejada/obsidian-edit-history) adds a configurable external backup directory for desktop filesystem vaults. It retains the upstream plugin ID (`edit-history`), settings, `.edtz` format, and history viewer.

## External backup directory (0.4.0)

1. Open **Settings → Edit History (External Backups)**.
2. Enter a full directory such as `D:\Obsidian Backups` in **External backup directory** and click **Apply**. Quoted paths, spaces, Unicode, and UNC network paths such as `\\server\share\Backups` are supported. The directory is created if needed and checked for write access before the setting is saved. Paths inside the vault are rejected.
3. Before editing notes at the new location, click **Copy history** to copy existing vault `.edtz` files. Originals are retained; files already present in the destination are skipped without merging or overwriting.

Each vault gets a separate subfolder, identified by its name and a short hash of its absolute vault path. Note folders are mirrored inside it, for example `D:\Obsidian Backups\My Vault-a1b2c3d4e5f6\Notes\Example.md.edtz`. The settings show the complete location. Different vaults may use the same backup directory, including vaults with identical names.

Leave the field empty and click **Apply** to restore vault storage. Changing the directory never automatically moves or deletes existing archives. **Copy history** imports from the vault only; changing between external directories requires copying the vault subfolder in Windows Explorer. When moving or renaming the vault itself, its hash/subfolder changes: copy the old vault subfolder's contents into the newly displayed subfolder to retain access to external history.

History saves, viewing, note moves/renames, folder renames, and deletions all use the selected location. As in upstream, deleting a note deletes its active history archive; this is revision history, not an independent undelete system. Preserved vault originals from an import are not deleted automatically. Unavailable or unwritable external storage raises a notice and does not silently save inside the vault. A network drive needs to be available whenever histories are saved or viewed. External storage requires desktop Obsidian; leave the setting blank on mobile.

## Install this fork

Download from [this fork's releases](https://github.com/neuronsarealsocool/obsidian-edit-history/releases/latest).

### Replace an existing Edit History installation

1. Turn off **Edit History** in the vault's Community plugins settings, then close that vault's Obsidian window.
2. Keep a copy of the existing `.obsidian/plugins/edit-history` folder. Extract `edit-history-install-0.4.0.zip` and copy its `main.js`, `manifest.json`, and `styles.css` into that folder, replacing those three files. Keep your existing `data.json` and all `.edtz` archives.
3. Reopen the vault and enable **Edit History (External Backups)**, then configure the directory using the steps above. Repeat for each vault.

The original and fork share an ID and replace each other. Updating from the standard community plugin listing can replace the fork with upstream, so manage updates from this fork instead.

### BRAT / new installation

In BRAT, add `neuronsarealsocool/obsidian-edit-history` as a beta plugin repository. Releases include `main.js`, `manifest.json`, and `styles.css` as direct assets for BRAT. For a pre-existing installation, the manual replacement steps above preserve your settings; use BRAT's repository tracking/update controls if you want BRAT to manage future fork releases.

### Development

Use Node.js 18 or newer. Run `npm ci`, then `npm test` (TypeScript check, production build, Windows filesystem tests, and plugin integration tests with a simulated Obsidian DOM). `npm run build` writes `main.js` in the checkout only; it never copies files into installed vaults. `npm run dev` watches source changes. Runtime dependencies and the AGPL-3.0 license are inherited from upstream.

The AI-ready full-folder release zip contains source, tests, configuration, the lockfile, license, and compiled plugin assets. It excludes `.git`, dependencies, and private runtime settings.

---

## Upstream documentation

This plugin saves each edit done to a note into a edit history file, the edits can later be diffed or copied.

![image](https://github.com/user-attachments/assets/e02be307-6945-46af-a8c0-02adbc48212d)

This is similar to the [File Recovery](https://help.obsidian.md/Plugins/File+recovery) core plugin with the following advantages:
- Can keep edit history of any type of file, selectable via settings
- Opensource edit history file format
- History files are kept independently per vault and file
- History files can be externally accessed, examined, copied around, or deleted
- History files can be backed up by external means
- Efficient compressed diff storage so it can be enabled without limits (number of edits, interval between edits max edit age...)
- Transparent storage size, easy to see how much the edit history for a given vault or note is taking

## Features

- Browse previous edits
- Choose edit by calendar view or by timeline view
- Diff one edit against a previous one
- Prev/Next button or keyboard diff navigation
- Timeline, side by side, top by bottom, or inline diff view
- Manually copy and paste a previous edit or parts of a previous edit
- Limit edit history frequency (set maximum interval of seconds between edits to save to the history file)
- Limit edit history file size by number of edits (keep less than a number of edits in the file, removing older ones)
- Limit edit history file size by age of edits (remove edits older than a given time from the history file)
- The edit history file is automatically managed when modifications are done to the note under Obsidian
  - renamed when the note is renamed (including folder changes).
  - deleted when the note is deleted
- Edit history files can be safely deleted outside of Obsidian in order to free storage.
- Keep edit history files for all files or just for the extensions specified in the settings
- Don't keep edit history files for those filepaths containing the substrings specified in the settings


## Usage

- Modify the plugin settings as desired
- Edit notes as usual, edits will be saved in the Edit History File for that note, as specified in the settings
- An edit can be manually saved by invoking the command *Edit History: Save current edit in the Edit History*
- Click on the clock ribbon icon or invoke the command *Edit History: Open Edit History For This File*
  - A dialog box with an activity calendar and a drop down of the stored edits will pop up. The year of the calendar is given by the year of the currently selected drop down option
  - Navigate through the different edits by picking from the drop down or clicking on the calendar
  - Insertions are shown as green, deletions as red
  - Copy the current edit with the Copy button
  - Navigate through diffs in this edit via keyboard or the Previous/Next buttons

## The edit history file

By default the plugin creates one edit history (.edtz) file per note in the same folder as the note. This fork can place those archives in an external directory as described above.

### Format

The edit history file is a zip file with diffs using [diff-match-patch](https://github.com/google/diff-match-patch).

The most recent version of the note is always stored in full in the zip file, so the edit history file does not depend on the note.

This most recent version may not be the latest version of the note if a non-zero time between edits was set.

Each entry in the file is named after the UTC epoch in seconds at which time the edit was made, encoded as chars, and ending in "$" if the entry is stored in full, otherwise stored as a diff.

## Versions

[Github releases](https://github.com/antoniotejada/obsidian-edit-history/releases)

### [0.3.0](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.3.0) (2025-08-03)
- Implemented #6 note path substring blacklist
- Fixed #28 empty edit history files being when minMsBetweenEdits is infinity (manual saving)

### [0.2.2](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.2.2) (2025-03-25)
- Shades bugfix for timeline
- Added timeline progress report

### [0.2.1](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.2.1) (2025-03-09)
- Performance bugfix for timeline diff view
- Calendar expand/collapse and other tweaks for small displays (mobile)

### [0.2.0](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.2.0) (2025-02-25)
- Implemented #8 https://github.com/antoniotejada/obsidian-edit-history/issues/8
  - Added side by side, top by bottom, inline, and timeline diff view and settings
- Other assorted enhancements to diff view:
  - Added calendar view
  - Added previous/next diff navigation
  - Added whitespace display in diff view and settings
  - Made diff view larger and lines breakable
  - Added display of current diff index
  - Choose edit date by timeline/slider/calendar view
  - Added keyboard navigation

### [0.1.3](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.1.3) (2023-08-11)
- Added versions section to README.md

### [0.1.2](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.1.2) (2023-08-11)
- Fix for #4 https://github.com/antoniotejada/obsidian-edit-history/issues/4

### [0.1.1](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.1.1) (2023-06-23)
- Changes to comply with plugin submission guidelines

### [0.1.0](https://github.com/antoniotejada/obsidian-edit-history/releases/tag/0.1.2) (2023-06-17)
- First fully functional version

## Upstream TODO
- Restore a given edit
- Diff one edit against another arbitrary edit
- Abstract out/refactor access to the edit history file
- Edit History File management:
  - find orphaned files
  - per file/vault statistics
  - merge/remove edits
  - ...
