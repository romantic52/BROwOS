import { ApiError } from './errors.js';

export interface SessionSnapshot {
  id: string;
  url: string;
  title: string;
  width: number;
  height: number;
  createdAt: string;
  lastActivityAt: string;
}

export type BrowserAction =
  | {
      type: 'click';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: 1 | 2;
    }
  | { type: 'move'; x: number; y: number }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'back' | 'forward' | 'reload' }
  | { type: 'resize'; width: number; height: number };

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_REQUEST', message);
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('The JSON body must be an object.');
  return value as Record<string, unknown>;
}

function finite(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function viewport(body: Record<string, unknown>): { width: number; height: number } {
  const width = finite(body.width ?? 1280, 320, 1920, 'width');
  const height = finite(body.height ?? 720, 240, 1080, 'height');
  if (!Number.isInteger(width) || !Number.isInteger(height))
    invalid('Viewport dimensions must be integers.');
  return { width, height };
}

export function parseNavigate(value: unknown): string {
  const body = objectBody(value);
  if (typeof body.url !== 'string' || !body.url || body.url.length > 4096) {
    invalid('url must be a nonempty string of at most 4096 characters.');
  }
  return body.url;
}

export function parseAction(value: unknown): BrowserAction {
  const body = objectBody(value);
  switch (body.type) {
    case 'click': {
      if (body.button !== undefined && !['left', 'middle', 'right'].includes(String(body.button))) {
        invalid('button must be left, middle or right.');
      }
      if (body.clickCount !== undefined && body.clickCount !== 1 && body.clickCount !== 2) {
        invalid('clickCount must be 1 or 2.');
      }
      return {
        type: 'click',
        x: finite(body.x, 0, 1920, 'x'),
        y: finite(body.y, 0, 1080, 'y'),
        button: (body.button ?? 'left') as 'left' | 'middle' | 'right',
        clickCount: (body.clickCount ?? 1) as 1 | 2,
      };
    }
    case 'move':
      return { type: 'move', x: finite(body.x, 0, 1920, 'x'), y: finite(body.y, 0, 1080, 'y') };
    case 'wheel':
      return {
        type: 'wheel',
        deltaX: finite(body.deltaX, -5000, 5000, 'deltaX'),
        deltaY: finite(body.deltaY, -5000, 5000, 'deltaY'),
      };
    case 'key': {
      if (
        typeof body.key !== 'string' ||
        body.key.length > 64 ||
        !/^(?:(?:Control|ControlOrMeta|Alt|Shift|Meta)\+){0,4}(?:[a-zA-Z0-9]|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|F(?:[1-9]|1[0-2]))$/.test(
          body.key,
        )
      ) {
        invalid('key must be a supported browser key or shortcut, such as Enter or Control+A.');
      }
      return { type: 'key', key: body.key };
    }
    case 'text':
      if (typeof body.text !== 'string' || body.text.length > 2048) {
        invalid('text must contain at most 2048 characters.');
      }
      return { type: 'text', text: body.text };
    case 'back':
    case 'forward':
    case 'reload':
      return { type: body.type };
    case 'resize':
      return { type: 'resize', ...viewport(body) };
    default:
      return invalid('Unknown browser action.');
  }
}

export interface SessionService {
  create(owner: string, dimensions: { width: number; height: number }): Promise<SessionSnapshot>;
  read(owner: string, id: string): Promise<SessionSnapshot>;
  navigate(owner: string, id: string, url: string): Promise<SessionSnapshot>;
  action(owner: string, id: string, action: BrowserAction): Promise<SessionSnapshot>;
  frame(owner: string, id: string): Promise<Buffer>;
  remove(owner: string, id: string): Promise<void>;
  close(): Promise<void>;
}
