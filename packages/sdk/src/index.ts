import type { VirtualFileSystem } from '@browos/filesystem';

export interface DesktopServices {
  fs: VirtualFileSystem;
  revision: number;
  openApp(appId: string, data?: Record<string, unknown>): void;
  openFile(id: string): void;
  notify(message: string, kind?: 'info' | 'success' | 'error'): void;
  setTitle(windowId: string, title: string): void;
  setCloseGuard(windowId: string, guard: (() => boolean) | null): void;
  pickFile(options?: { accept?: string; title?: string }): Promise<string | null>;
  saveFile(options: {
    name: string;
    content: Blob | string;
    mime?: string;
    parentId?: string;
    existingId?: string;
  }): Promise<string | null>;
}

export interface AppProps {
  services: DesktopServices;
  windowId: string;
  data?: Record<string, unknown>;
}

export interface AppManifest {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  defaultSize: { width: number; height: number };
  singleton?: boolean;
  extensions?: string[];
}
