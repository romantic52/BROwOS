/** Persistent, transactional virtual files shared by every BROwOS application. */
export interface FSNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'file' | 'directory';
  mime: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  trashed?: boolean;
  originalParentId?: string | null;
}

export type FSErrorCode =
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'NOT_FILE'
  | 'INVALID_NAME'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'PROTECTED'
  | 'INVALID_MOVE'
  | 'INVALID_BACKUP'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE'
  | 'DATABASE_BLOCKED'
  | 'CLOSED';

export class FSError extends Error {
  constructor(
    public readonly code: FSErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FSError';
  }
}

interface StoredNode extends FSNode {
  data?: Blob;
  trashRootId?: string;
}

interface BackupNode extends FSNode {
  contentsBase64?: string;
  trashRootId?: string;
}

type Tree = Map<string, StoredNode>;

const SYSTEM_FOLDERS = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
  pictures: 'Pictures',
  music: 'Music',
  videos: 'Videos',
} as const;

const PROTECTED_IDS = new Set(['root', ...Object.keys(SYSTEM_FOLDERS)]);
const BACKUP_FORMAT = 'BROwOS filesystem backup';
const MAX_BACKUP_NODES = 20_000;
const MAX_BACKUP_LENGTH = 140_000_000;

function publicNode(node: StoredNode): FSNode {
  const result: FSNode = {
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    kind: node.kind,
    mime: node.mime,
    size: node.size,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
  if (node.trashed) result.trashed = true;
  if (node.originalParentId !== undefined) result.originalParentId = node.originalParentId;
  return result;
}

function fold(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

function validName(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    value.trim().length === 0 ||
    value === '.' ||
    value === '..' ||
    /[/\\<>:"|?*]/u.test(value) ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /[. ]$/u.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)
  ) {
    throw new FSError(
      'INVALID_NAME',
      'Use 1–255 characters without slashes, reserved device names, or a trailing space or dot.',
    );
  }
  return value.normalize('NFC');
}

function uniqueId(tree: Tree): string {
  let id: string;
  do {
    id =
      globalThis.crypto?.randomUUID?.() ??
      `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  } while (tree.has(id));
  return id;
}

function required(tree: Tree, id: string): StoredNode {
  const node = tree.get(id);
  if (!node) throw new FSError('NOT_FOUND', 'The file or folder no longer exists.');
  return node;
}

function liveDirectory(tree: Tree, id: string): StoredNode {
  const node = required(tree, id);
  if (node.kind !== 'directory')
    throw new FSError('NOT_DIRECTORY', 'The destination must be a folder.');
  if (node.trashed)
    throw new FSError('NOT_FOUND', 'Restore the destination folder before using it.');
  return node;
}

function assertMutable(id: string): void {
  if (PROTECTED_IDS.has(id)) {
    throw new FSError('PROTECTED', 'BROwOS system folders cannot be renamed, moved, or deleted.');
  }
}

function siblingExists(tree: Tree, parentId: string, name: string, exceptId?: string): boolean {
  const key = fold(name);
  return Array.from(tree.values()).some(
    (node) =>
      node.id !== exceptId &&
      node.parentId === parentId &&
      !node.trashed &&
      fold(node.name) === key,
  );
}

function assertAvailable(tree: Tree, parentId: string, name: string, exceptId?: string): void {
  if (siblingExists(tree, parentId, name, exceptId)) {
    throw new FSError('ALREADY_EXISTS', `“${name}” already exists in this folder.`);
  }
}

function copyName(tree: Tree, parentId: string, name: string, suffix: 'Copy' | 'Imported'): string {
  if (!siblingExists(tree, parentId, name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && name.length - dot <= 32;
  const extension = hasExtension ? name.slice(dot) : '';
  const stem = hasExtension ? name.slice(0, dot) : name;
  for (let number = 1; ; number += 1) {
    const ending = ` - ${suffix}${number === 1 ? '' : ` (${number})`}${extension}`;
    const candidate = `${stem.slice(0, Math.max(1, 255 - ending.length))}${ending}`;
    if (!siblingExists(tree, parentId, candidate)) return candidate;
  }
}

function descendants(tree: Tree, id: string): StoredNode[] {
  const result: StoredNode[] = [];
  const pending = [id];
  const seen = new Set<string>();
  const children = new Map<string, string[]>();
  for (const node of tree.values()) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const current = pending[cursor];
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(required(tree, current));
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}

function assertOutsideSubtree(tree: Tree, id: string, targetId: string): void {
  let current: string | null = targetId;
  while (current !== null) {
    if (current === id)
      throw new FSError(
        'INVALID_MOVE',
        'A folder cannot be placed inside itself or its descendants.',
      );
    current = required(tree, current).parentId;
  }
}

function touch(tree: Tree, id: string | null): void {
  if (!id) return;
  const node = required(tree, id);
  tree.set(id, { ...node, updatedAt: Math.max(Date.now(), node.updatedAt + 1) });
}

function mimeFor(name: string, data: Blob | string, requested?: string): string {
  if (requested) return requested;
  if (data instanceof Blob && data.type) return data.type;
  const types: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/plain',
    csv: 'text/csv',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return (
    types[name.split('.').pop()?.toLowerCase() ?? ''] ??
    (typeof data === 'string' ? 'text/plain' : 'application/octet-stream')
  );
}

function storageError(error: unknown): Error {
  if (error instanceof FSError) return error;
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return new FSError(
      'QUOTA_EXCEEDED',
      'Browser storage is full. Export a backup, empty the Recycle Bin, or free storage, then retry. No partial changes were saved.',
    );
  }
  if (error instanceof Error) return error;
  return new FSError('STORAGE_UNAVAILABLE', 'Browser storage could not complete this operation.');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionFinished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The storage transaction was aborted.'));
    transaction.onerror = () => {
      /* The abort event reports the final transaction error. */
    };
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        new FSError(
          'STORAGE_UNAVAILABLE',
          'IndexedDB is unavailable. Enable browser storage to use BROwOS.',
        ),
      );
      return;
    }
    const request = indexedDB.open(name, 1);
    let rejected = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('nodes'))
        database.createObjectStore('nodes', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta'))
        database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      rejected = true;
      reject(storageError(request.error));
    };
    request.onblocked = () => {
      rejected = true;
      reject(
        new FSError(
          'DATABASE_BLOCKED',
          'Close older BROwOS tabs so the storage database can be opened.',
        ),
      );
    };
  });
}

const WELCOME = `Welcome to BROwOS!

This is a real file in your browser's persistent virtual filesystem.
Open it in Notepad, edit it, save it, and reload the page: your changes remain.

Try these things:
• Create a folder in Documents and move this file into it.
• Draw something in Paint, then save it to Pictures.
• Import an image or a song with File Explorer.
• Delete a file, open Recycle Bin, and restore it.
• Export a filesystem backup before clearing your browser's site data.

Local files belong to this browser profile and this website origin. Private browsing,
clearing site data, or browser storage eviction can remove them. Keep backups of important files.
BROwOS is an independent desktop environment inspired by Windows 10.
`;

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#071b48"/><stop offset="1" stop-color="#2279c7"/></linearGradient><linearGradient id="lake" x2="0" y2="1"><stop stop-color="#267ec0"/><stop offset="1" stop-color="#071d44"/></linearGradient></defs>
<rect width="1280" height="800" fill="url(#sky)"/>
<circle cx="945" cy="170" r="65" fill="#b6e9ff"/>
<g fill="#c5e8ff" opacity=".8"><circle cx="110" cy="96" r="2"/><circle cx="320" cy="60" r="3"/><circle cx="610" cy="130" r="2"/><circle cx="740" cy="65" r="2"/><circle cx="1140" cy="72" r="3"/></g>
<path d="M0 475 220 235 470 500 710 155 1000 490 1160 315 1280 455V650H0Z" fill="#193964"/>
<path d="m710 155-103 155 95-29 44 49 51-26zM220 235l-64 76 68-18 51 31z" fill="#a8d7ee"/>
<path d="M0 500 230 370 475 560 830 340 1080 555 1280 430V700H0Z" fill="#10294e"/>
<path d="M0 580Q400 535 700 575T1280 565V800H0Z" fill="url(#lake)"/>
<g stroke="#76c9ec" opacity=".3" stroke-width="3"><path d="M740 650h280M805 665h180M690 690h290M470 725h400M610 745h180"/></g>
<path d="M0 610 90 585 140 622 230 603 305 657 245 800H0ZM1280 620l-120 30-50 150h170Z" fill="#07172f"/>
<text x="62" y="735" fill="#e6f4ff" font-family="sans-serif" font-size="46" font-weight="600">BROwOS</text><text x="65" y="769" fill="#8abbdc" font-family="sans-serif" font-size="18">A little room for big ideas.</text>
</svg>`;

/**
 * Metadata reads are synchronous snapshots; mutations always load the latest state in
 * one read/write transaction. Cross-tab broadcasts refresh snapshots; concurrent writes
 * serialize in IndexedDB and revalidate their destination, avoiding lost updates.
 */
export class VirtualFileSystem {
  readonly rootId = 'root';
  revision = 0;
  private nodes: Tree = new Map();
  private listeners = new Set<() => void>();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private channel?: BroadcastChannel;
  private readonly instanceId = uniqueId(new Map());
  private readonly onFocus = (): void => {
    void this.refresh().catch(() => undefined);
  };

  private constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => this.close();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onFocus);
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          this.channel = new BroadcastChannel(`browos-filesystem:${database.name}`);
          this.channel.onmessage = (
            event: MessageEvent<{ source?: string; revision?: number }>,
          ) => {
            if (
              event.data?.source !== this.instanceId &&
              (event.data?.revision ?? 0) > this.revision
            )
              this.onFocus();
          };
        } catch {
          /* Restricted browser contexts can use the focus/explicit-refresh fallback. */
        }
      }
    }
  }

  static async create(databaseName = 'browos'): Promise<VirtualFileSystem> {
    const filesystem = new VirtualFileSystem(await openDatabase(databaseName));
    try {
      await filesystem.mutate((tree) => {
        if (tree.has('root')) return;
        const now = Date.now();
        tree.set('root', {
          id: 'root',
          parentId: null,
          name: 'BROwOS',
          kind: 'directory',
          mime: 'inode/directory',
          size: 0,
          createdAt: now,
          updatedAt: now,
        });
        for (const [id, name] of Object.entries(SYSTEM_FOLDERS)) {
          tree.set(id, {
            id,
            parentId: 'root',
            name,
            kind: 'directory',
            mime: 'inode/directory',
            size: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        const welcome = new Blob([WELCOME], { type: 'text/plain' });
        tree.set('welcome', {
          id: 'welcome',
          parentId: 'documents',
          name: 'Welcome to BROwOS.txt',
          kind: 'file',
          mime: welcome.type,
          size: welcome.size,
          data: welcome,
          createdAt: now,
          updatedAt: now,
        });
        const picture = new Blob([SAMPLE_SVG], { type: 'image/svg+xml' });
        tree.set('sample-landscape', {
          id: 'sample-landscape',
          parentId: 'pictures',
          name: 'BROwOS Mountains.svg',
          kind: 'file',
          mime: picture.type,
          size: picture.size,
          data: picture,
          createdAt: now,
          updatedAt: now,
        });
      });
      return filesystem;
    } catch (error) {
      filesystem.close();
      throw storageError(error);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* A broken UI subscriber must not invalidate a committed write. */
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(() => {
      if (this.closed) throw new FSError('CLOSED', 'This filesystem connection has been closed.');
      return operation();
    });
    this.pending = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private mutate<T>(operation: (tree: Tree) => T): Promise<T> {
    return this.enqueue(async () => {
      const transaction = this.database.transaction(['nodes', 'meta'], 'readwrite');
      const finished = transactionFinished(transaction);
      // Attach a rejection handler immediately, including when validation aborts below.
      void finished.catch(() => undefined);
      try {
        const store = transaction.objectStore('nodes');
        const [records, metadata] = await Promise.all([
          requestResult(store.getAll() as IDBRequest<StoredNode[]>),
          requestResult(
            transaction.objectStore('meta').get('revision') as IDBRequest<
              { key: string; value: number } | undefined
            >,
          ),
        ]);
        const original: Tree = new Map(records.map((node) => [node.id, node]));
        const next: Tree = new Map(original);
        const result = operation(next);
        let changed = false;
        for (const [id, node] of next) {
          if (original.get(id) !== node) {
            store.put(node);
            changed = true;
          }
        }
        for (const id of original.keys()) {
          if (!next.has(id)) {
            store.delete(id);
            changed = true;
          }
        }
        const revision = (metadata?.value ?? 0) + (changed ? 1 : 0);
        if (changed) transaction.objectStore('meta').put({ key: 'revision', value: revision });
        await finished;
        const shouldNotify = this.revision !== revision;
        this.nodes = next;
        this.revision = revision;
        if (shouldNotify) this.emit();
        if (changed && !this.closed) {
          try {
            this.channel?.postMessage({ source: this.instanceId, revision });
          } catch {
            /* Advisory notification failures do not undo a committed transaction. */
          }
        }
        return result;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* It may already have been aborted by IndexedDB. */
        }
        await finished.catch(() => undefined);
        throw storageError(error);
      }
    });
  }

  /** Refresh the synchronous snapshot explicitly, useful without BroadcastChannel. */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const transaction = this.database.transaction(['nodes', 'meta'], 'readonly');
      const finished = transactionFinished(transaction);
      void finished.catch(() => undefined);
      try {
        const [records, metadata] = await Promise.all([
          requestResult(transaction.objectStore('nodes').getAll() as IDBRequest<StoredNode[]>),
          requestResult(
            transaction.objectStore('meta').get('revision') as IDBRequest<
              { key: string; value: number } | undefined
            >,
          ),
        ]);
        await finished;
        const revision = metadata?.value ?? 0;
        const changed = revision !== this.revision;
        this.nodes = new Map(records.map((node) => [node.id, node]));
        this.revision = revision;
        if (changed) this.emit();
      } catch (error) {
        await finished.catch(() => undefined);
        throw storageError(error);
      }
    });
  }

  get(id: string): FSNode | undefined {
    const node = this.nodes.get(id);
    return node ? publicNode(node) : undefined;
  }

  list(parentId: string): FSNode[] {
    return this.sorted(
      Array.from(this.nodes.values()).filter((node) => node.parentId === parentId && !node.trashed),
    );
  }

  private sorted(nodes: StoredNode[]): FSNode[] {
    return nodes
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      })
      .map(publicNode);
  }

  search(query: string): FSNode[] {
    const needle = fold(query.trim());
    if (!needle) return [];
    return this.sorted(
      Array.from(this.nodes.values()).filter(
        (node) => node.id !== 'root' && !node.trashed && fold(node.name).includes(needle),
      ),
    );
  }

  path(id: string): string {
    const names: string[] = [];
    let current = required(this.nodes, id);
    while (current.parentId !== null) {
      names.unshift(current.name);
      current = required(this.nodes, current.parentId);
    }
    return `/${names.join('/')}`;
  }

  resolve(path: string): FSNode | undefined {
    const parts = path
      .replaceAll('\\', '/')
      .replace(/^c:\/?/iu, '/')
      .replace(/^~\/?/u, '/')
      .split('/');
    let node = this.nodes.get('root');
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (!node || node.kind !== 'directory') return undefined;
      if (part === '..') node = this.nodes.get(node.parentId ?? 'root');
      else
        node = Array.from(this.nodes.values()).find(
          (candidate) =>
            candidate.parentId === node?.id &&
            !candidate.trashed &&
            fold(candidate.name) === fold(part),
        );
    }
    return node ? publicNode(node) : undefined;
  }

  listTrash(): FSNode[] {
    return this.sorted(
      Array.from(this.nodes.values()).filter(
        (node) => node.trashed && !this.nodes.get(node.parentId ?? '')?.trashed,
      ),
    );
  }

  async mkdir(parentId: string, rawName: string): Promise<FSNode> {
    const name = validName(rawName);
    return this.mutate((tree) => {
      liveDirectory(tree, parentId);
      assertAvailable(tree, parentId, name);
      const now = Date.now();
      const node: StoredNode = {
        id: uniqueId(tree),
        parentId,
        name,
        kind: 'directory',
        mime: 'inode/directory',
        size: 0,
        createdAt: now,
        updatedAt: now,
      };
      tree.set(node.id, node);
      touch(tree, parentId);
      return publicNode(node);
    });
  }

  async writeFile(
    parentId: string,
    rawName: string,
    data: Blob | string,
    mime?: string,
  ): Promise<FSNode> {
    const name = validName(rawName);
    const file = new Blob([data], { type: mimeFor(name, data, mime) });
    return this.mutate((tree) => {
      liveDirectory(tree, parentId);
      assertAvailable(tree, parentId, name);
      const now = Date.now();
      const node: StoredNode = {
        id: uniqueId(tree),
        parentId,
        name,
        kind: 'file',
        mime: file.type,
        size: file.size,
        data: file,
        createdAt: now,
        updatedAt: now,
      };
      tree.set(node.id, node);
      touch(tree, parentId);
      return publicNode(node);
    });
  }

  async updateFile(
    id: string,
    data: Blob | string,
    mime?: string,
    expectedUpdatedAt?: number,
  ): Promise<FSNode> {
    return this.mutate((tree) => {
      const node = required(tree, id);
      if (node.kind !== 'file')
        throw new FSError('NOT_FILE', 'Only files can have their contents edited.');
      if (node.trashed) throw new FSError('NOT_FOUND', 'Restore this file before editing it.');
      if (expectedUpdatedAt !== undefined && node.updatedAt !== expectedUpdatedAt) {
        throw new FSError(
          'CONFLICT',
          'This file changed since it was opened. Reload its latest contents or save your changes under a new name.',
        );
      }
      const file = new Blob([data], { type: mime ?? node.mime ?? mimeFor(node.name, data) });
      const next = {
        ...node,
        data: file,
        mime: file.type,
        size: file.size,
        updatedAt: Math.max(Date.now(), node.updatedAt + 1),
      };
      tree.set(id, next);
      touch(tree, node.parentId);
      return publicNode(next);
    });
  }

  async readFile(id: string): Promise<Blob> {
    await this.refresh();
    const node = required(this.nodes, id);
    if (node.kind !== 'file' || !node.data)
      throw new FSError('NOT_FILE', 'Select a file to read its contents.');
    return node.data.slice(0, node.data.size, node.mime);
  }

  async readText(id: string): Promise<string> {
    return (await this.readFile(id)).text();
  }

  async rename(id: string, rawName: string): Promise<FSNode> {
    const name = validName(rawName);
    return this.mutate((tree) => {
      assertMutable(id);
      const node = required(tree, id);
      if (node.trashed) throw new FSError('NOT_FOUND', 'Restore this item before renaming it.');
      assertAvailable(tree, node.parentId ?? 'root', name, id);
      const next = { ...node, name, updatedAt: Math.max(Date.now(), node.updatedAt + 1) };
      tree.set(id, next);
      touch(tree, node.parentId);
      return publicNode(next);
    });
  }

  async move(id: string, parentId: string): Promise<FSNode> {
    return this.mutate((tree) => {
      assertMutable(id);
      const node = required(tree, id);
      if (node.trashed) throw new FSError('NOT_FOUND', 'Restore this item before moving it.');
      liveDirectory(tree, parentId);
      assertOutsideSubtree(tree, id, parentId);
      assertAvailable(tree, parentId, node.name, id);
      if (node.parentId === parentId) return publicNode(node);
      const next = { ...node, parentId, updatedAt: Math.max(Date.now(), node.updatedAt + 1) };
      tree.set(id, next);
      touch(tree, node.parentId);
      touch(tree, parentId);
      return publicNode(next);
    });
  }

  async copy(id: string, parentId: string): Promise<FSNode> {
    return this.mutate((tree) => {
      const node = required(tree, id);
      if (node.trashed) throw new FSError('NOT_FOUND', 'Restore this item before copying it.');
      liveDirectory(tree, parentId);
      assertOutsideSubtree(tree, id, parentId);
      const originals = descendants(tree, id).filter((child) => !child.trashed);
      const remap = new Map<string, string>();
      let copiedRoot: StoredNode | undefined;
      for (const original of originals) {
        const newId = uniqueId(tree);
        remap.set(original.id, newId);
        const now = Date.now();
        const copy: StoredNode = {
          ...original,
          id: newId,
          parentId:
            original.id === id ? parentId : (remap.get(original.parentId ?? '') ?? parentId),
          name:
            original.id === id ? copyName(tree, parentId, original.name, 'Copy') : original.name,
          createdAt: now,
          updatedAt: now,
        };
        delete copy.originalParentId;
        tree.set(newId, copy);
        if (original.id === id) copiedRoot = copy;
      }
      touch(tree, parentId);
      return publicNode(copiedRoot as StoredNode);
    });
  }

  async trash(id: string): Promise<void> {
    return this.mutate((tree) => {
      assertMutable(id);
      const root = required(tree, id);
      if (root.trashed) return;
      for (const node of descendants(tree, id)) {
        // Preserve independently deleted descendants when their parent is later deleted.
        if (node.trashed) continue;
        tree.set(node.id, {
          ...node,
          trashed: true,
          trashRootId: id,
          originalParentId: node.originalParentId ?? node.parentId,
          updatedAt: Math.max(Date.now(), node.updatedAt + 1),
        });
      }
      touch(tree, root.parentId);
    });
  }

  async restore(id: string): Promise<FSNode> {
    return this.mutate((tree) => {
      const node = required(tree, id);
      if (!node.trashed) return publicNode(node);
      const originalParent = tree.get(node.originalParentId ?? node.parentId ?? 'documents');
      const parentId =
        originalParent?.kind === 'directory' && !originalParent.trashed
          ? originalParent.id
          : 'documents';
      assertAvailable(tree, parentId, node.name, id);
      const trashRootId = node.trashRootId ?? id;
      for (const child of descendants(tree, id)) {
        if (child.trashRootId && child.trashRootId !== trashRootId) continue;
        const restored = {
          ...child,
          trashed: false,
          updatedAt: Math.max(Date.now(), child.updatedAt + 1),
        };
        delete restored.originalParentId;
        delete restored.trashRootId;
        if (child.id === id) restored.parentId = parentId;
        tree.set(child.id, restored);
      }
      touch(tree, parentId);
      return publicNode(required(tree, id));
    });
  }

  async deletePermanent(id: string): Promise<void> {
    return this.mutate((tree) => {
      assertMutable(id);
      const node = required(tree, id);
      for (const child of descendants(tree, id)) tree.delete(child.id);
      touch(tree, node.parentId);
    });
  }

  getUsage(): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    for (const node of this.nodes.values()) {
      if (node.kind === 'file') {
        files += 1;
        bytes += node.size;
      }
    }
    return { files, bytes };
  }

  /** Full data backup, including the Recycle Bin; import is additive and never overwrites. */
  async exportBackup(): Promise<string> {
    await this.refresh();
    const records = Array.from(this.nodes.values());
    const nodes: BackupNode[] = [];
    for (const record of records) {
      const node: BackupNode = publicNode(record);
      if (record.trashRootId) node.trashRootId = record.trashRootId;
      if (record.kind === 'file') {
        const bytes = new Uint8Array(await (record.data ?? new Blob()).arrayBuffer());
        const pieces: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 32_768) {
          pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
        }
        node.contentsBase64 = btoa(pieces.join(''));
      }
      nodes.push(node);
    }
    return JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes,
    });
  }

  async importBackup(json: string): Promise<void> {
    const imported = parseBackup(json);
    await this.mutate((tree) => {
      const remap = new Map<string, string>(Array.from(PROTECTED_IDS).map((id) => [id, id]));
      const sourceTree: Tree = new Map(imported.map((node) => [node.id, node]));
      // Parent-first insertion preserves the complete hierarchy and checks every collision.
      for (const original of descendants(sourceTree, 'root')) {
        if (PROTECTED_IDS.has(original.id)) continue;
        const parentId = remap.get(original.parentId ?? '') as string;
        const id = uniqueId(tree);
        remap.set(original.id, id);
        const node: StoredNode = {
          ...original,
          id,
          parentId,
          name: original.trashed
            ? original.name
            : copyName(tree, parentId, original.name, 'Imported'),
        };
        if (original.originalParentId !== undefined) {
          node.originalParentId = remap.get(original.originalParentId ?? '') ?? parentId;
        }
        if (original.trashRootId) node.trashRootId = remap.get(original.trashRootId) ?? id;
        tree.set(id, node);
      }
      touch(tree, 'root');
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.channel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus);
    this.database.close();
    this.listeners.clear();
  }
}

function parseBackup(json: string): StoredNode[] {
  const invalid = (message: string): never => {
    throw new FSError('INVALID_BACKUP', message);
  };
  if (typeof json !== 'string' || json.length > MAX_BACKUP_LENGTH)
    invalid('Backups must be JSON text smaller than 140 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid('The backup is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') return invalid('This is not a BROwOS backup.');
  const backup = parsed as Record<string, unknown>;
  if (backup.format !== BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.nodes))
    return invalid('Unsupported BROwOS backup format or version.');
  if (backup.nodes.length > MAX_BACKUP_NODES)
    invalid(`A backup can contain at most ${MAX_BACKUP_NODES} items.`);
  const tree: Tree = new Map();
  for (const value of backup.nodes) {
    if (!value || typeof value !== 'object') invalid('A backup item is invalid.');
    const raw = value as Record<string, unknown>;
    if (
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      raw.id.length > 256 ||
      tree.has(raw.id)
    )
      invalid('Backup item IDs must be unique strings.');
    if (typeof raw.name !== 'string') invalid('An item name is missing.');
    let name: string;
    try {
      name = validName(raw.name as string);
    } catch {
      return invalid('A backup contains an invalid file or folder name.');
    }
    if (raw.kind !== 'file' && raw.kind !== 'directory')
      invalid('A backup item has an unsupported kind.');
    if (raw.parentId !== null && typeof raw.parentId !== 'string')
      invalid('An item parent is invalid.');
    if (
      typeof raw.mime !== 'string' ||
      raw.mime.length > 255 ||
      Array.from(raw.mime).some((character) => character.charCodeAt(0) < 32)
    )
      invalid('An item MIME type is invalid.');
    if (typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 0)
      invalid('An item size is invalid.');
    if (
      typeof raw.createdAt !== 'number' ||
      !Number.isFinite(raw.createdAt) ||
      raw.createdAt < 0 ||
      typeof raw.updatedAt !== 'number' ||
      !Number.isFinite(raw.updatedAt) ||
      raw.updatedAt < raw.createdAt
    )
      invalid('An item timestamp is invalid.');
    if (raw.trashed !== undefined && typeof raw.trashed !== 'boolean')
      invalid('An item trash state is invalid.');
    if (
      raw.originalParentId !== undefined &&
      raw.originalParentId !== null &&
      typeof raw.originalParentId !== 'string'
    )
      invalid('An item restore location is invalid.');
    if (raw.trashRootId !== undefined && (typeof raw.trashRootId !== 'string' || !raw.trashed))
      invalid('An item trash group is invalid.');
    const node: StoredNode = {
      id: raw.id as string,
      name,
      parentId: raw.parentId as string | null,
      kind: raw.kind as 'file' | 'directory',
      mime: raw.mime as string,
      size: raw.size as number,
      createdAt: raw.createdAt as number,
      updatedAt: raw.updatedAt as number,
    };
    if (raw.trashed) node.trashed = true;
    if (raw.originalParentId !== undefined)
      node.originalParentId = raw.originalParentId as string | null;
    if (raw.trashRootId !== undefined) node.trashRootId = raw.trashRootId as string;
    if (node.kind === 'file') {
      if (
        typeof raw.contentsBase64 !== 'string' ||
        raw.contentsBase64.length % 4 !== 0 ||
        /[^A-Za-z0-9+/=]/u.test(raw.contentsBase64)
      )
        invalid('A file has invalid base64 contents.');
      let binary: string;
      try {
        binary = atob(raw.contentsBase64 as string);
      } catch {
        return invalid('A file has invalid base64 contents.');
      }
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      if (bytes.length !== node.size) invalid('A file size does not match its contents.');
      node.data = new Blob([bytes], { type: node.mime });
    } else if (node.size !== 0 || raw.contentsBase64 !== undefined)
      invalid('Folders cannot contain file data.');
    tree.set(node.id, node);
  }
  const root = tree.get('root');
  if (
    !root ||
    root.kind !== 'directory' ||
    root.parentId !== null ||
    root.trashed ||
    root.name !== 'BROwOS'
  )
    invalid('The backup has no valid BROwOS root.');
  for (const [id, name] of Object.entries(SYSTEM_FOLDERS)) {
    const node = tree.get(id);
    if (
      !node ||
      node.kind !== 'directory' ||
      node.name !== name ||
      node.parentId !== 'root' ||
      node.trashed
    )
      invalid('The backup has missing or invalid system folders.');
  }
  const siblings = new Set<string>();
  for (const node of tree.values()) {
    if (node.id === 'root') continue;
    const parent = tree.get(node.parentId ?? '');
    if (!parent || parent.kind !== 'directory')
      invalid('A file or folder has a missing or invalid parent.');
    if (parent?.trashed && !node.trashed) invalid('A live item cannot be inside a deleted folder.');
    if (!node.trashed) {
      const key = JSON.stringify([node.parentId, fold(node.name)]);
      if (siblings.has(key)) invalid('The backup contains duplicate names in a folder.');
      siblings.add(key);
    }
    const visited = new Set<string>([node.id]);
    let current = node.parentId;
    while (current !== null) {
      if (visited.has(current) || visited.size > 256)
        invalid('The backup contains a folder cycle or exceeds 256 levels.');
      visited.add(current);
      const ancestor = tree.get(current);
      if (!ancestor) invalid('The backup contains an orphaned folder.');
      current = ancestor?.parentId ?? null;
    }
    if (
      node.trashRootId &&
      (!visited.has(node.trashRootId) || !tree.get(node.trashRootId)?.trashed)
    )
      invalid('An item trash group does not belong to its deleted ancestor.');
  }
  return Array.from(tree.values());
}
