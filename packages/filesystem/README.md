# @browos/filesystem

The shared persistent virtual filesystem used by BROwOS applications. File metadata and
Blob contents are stored together in native IndexedDB transactions. This package does
not need a backend or access to the host computer's directories.

## Usage

```ts
import { VirtualFileSystem, FSError } from '@browos/filesystem';

const fs = await VirtualFileSystem.create('browos');
const unsubscribe = fs.subscribe(() => renderFileList(fs.list('documents')));

const folder = await fs.mkdir('documents', 'Project');
let note = await fs.writeFile(folder.id, 'notes.txt', 'First draft');
note = await fs.updateFile(note.id, 'Second draft', 'text/plain', note.updatedAt);
const contents = await fs.readText(note.id);

const backupJson = await fs.exportBackup();
await fs.importBackup(backupJson); // Adds renamed copies; existing data is retained.

unsubscribe();
fs.close();
```

`renderFileList` in the example represents the application's own rendering function.
Handle `FSError` using its stable `code` property and human-readable `message`.

## Interface

| Operation                                         | Behavior                                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(databaseName?)`                           | Opens persistent storage and seeds the system folders on the first run.                                                                                                                  |
| `get(id)`, `list(parentId)`, `search(query)`      | Synchronous metadata snapshots. Returned objects cannot mutate internal state. Lists and searches omit deleted items.                                                                    |
| `path(id)`, `resolve(path)`                       | Slash-based paths such as `/Documents/notes.txt`; resolution also accepts backslashes, `C:/`, `~`, `.` and `..`. Names are case-insensitive.                                             |
| `mkdir(parentId, name)`                           | Creates a directory; rejects an existing name.                                                                                                                                           |
| `writeFile(parentId, name, data, mime?)`          | Creates a file from a Blob or UTF-8 string; never overwrites an existing item.                                                                                                           |
| `updateFile(id, data, mime?, expectedUpdatedAt?)` | Replaces a file's contents atomically. An expected timestamp enables stale-editor conflict detection.                                                                                    |
| `readFile(id)`, `readText(id)`                    | Read fresh persisted contents as a Blob or string.                                                                                                                                       |
| `rename(id, name)`, `move(id, parentId)`          | Preserve IDs and descendants. Reject collisions, invalid parents and directory cycles.                                                                                                   |
| `copy(id, parentId)`                              | Copies a directory tree with new IDs; adds ` - Copy`, then a number, when needed. Previously deleted descendants are omitted.                                                            |
| `trash(id)`, `listTrash()`                        | Recursively marks a subtree deleted; lists top-level Recycle Bin entries. Contents still occupy storage.                                                                                 |
| `restore(id)`                                     | Restores a subtree to its original directory. If that directory is still deleted, restores to Documents. Name collisions are reported. Independently deleted descendants remain deleted. |
| `deletePermanent(id)`                             | Irreversibly deletes the selected user item and all descendants. A caller should confirm this action in the UI.                                                                          |
| `exportBackup()`, `importBackup(json)`            | Full JSON/base64 backups including the Recycle Bin. Import validates everything before a single additive transaction; existing files are never replaced.                                 |
| `getUsage()`                                      | Logical file count and total file bytes, including Recycle Bin contents; excludes IndexedDB metadata overhead.                                                                           |
| `refresh()`                                       | Reloads the synchronous metadata snapshot from persistent storage.                                                                                                                       |
| `revision`, `subscribe(listener)`                 | Revision increments after commits. Subscribers run only after the transaction commits.                                                                                                   |
| `close()`                                         | Releases database, event listeners and broadcast resources.                                                                                                                              |

All storage operations are asynchronous. Metadata lookup, path lookup, usage and
subscription operations are synchronous.

## System folders and first-run content

The protected root ID is `root`, with stable children `desktop`, `documents`, `downloads`,
`pictures`, `music`, and `videos`. These directories cannot be renamed, moved or deleted.
Their contents behave like ordinary user files.

The first run creates `welcome` (`/Documents/Welcome to BROwOS.txt`) and
`sample-landscape` (`/Pictures/BROwOS Mountains.svg`). The SVG contains programmatic
landscape shapes and can be opened in Photos; the welcome document can be edited in
Notepad. Seeding is transactional and does not duplicate content on reload.

## Consistency and editor conflicts

Each mutation loads the latest records inside one IndexedDB read/write transaction,
revalidates the requested operation, and commits metadata, contents and the revision
together. Two tabs creating different files cannot overwrite each other's directory
snapshots. Competing names are checked against the latest committed state. A failed
operation, including a quota error after earlier records were queued, aborts the entire
transaction.

BroadcastChannel refreshes other active tabs. A window-focus refresh provides a fallback
where broadcasting is unavailable. Metadata reads can briefly represent an older
snapshot; call `await fs.refresh()` when an immediate cross-tab refresh is necessary.

For editors, retain the `updatedAt` returned when opening or saving the file and pass it
as the fourth argument to `updateFile`. A conflicting change then raises `CONFLICT`.
Without this optional argument, saves use last-writer-wins behavior. Refreshing a file
list alone cannot protect an editor's unsaved buffer.

## Backup validation and storage limits

Imports check the format/version, IDs, names, MIME types, timestamps, base64 data, byte
counts, required system folders, parents, duplicate live names, deleted ancestors and
folder cycles before modifying storage. Imported user IDs are remapped. Existing-name
collisions produce ` - Imported` copies. System folders preserve their identity.

The current JSON backup importer accepts up to 20,000 items, 256 directory levels and
140 million JSON characters. Backups are constructed in memory and are intended for
documents and modest media libraries; streaming archives and very large collections
are future work. Logical usage is not the browser's available-storage quota. Applications
can use `navigator.storage.estimate()` for the latter.

Persistence belongs to the browser profile and website origin. Private browsing,
clearing site data and browser eviction can remove it. Keep exported backups of
important files. IndexedDB supplies transactional persistence; it does not synchronize
data between devices or provide encryption at rest.

## Verification

From the repository root:

```sh
pnpm exec vitest run tests/filesystem
pnpm exec eslint packages/filesystem tests/filesystem
```

The behavioral suite uses fake-indexeddb and exercises persistence after reopening,
real Blob/UTF-8 data, tree operations, safety invariants, recursive and independent
deletion, additive backups, malformed input, concurrent connections, editor conflicts,
subscriber isolation and injected mid-transaction quota rollback. Browser application
integration is verified separately by the repository's E2E suite.
