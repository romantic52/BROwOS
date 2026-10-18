import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  minus: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  restore: 'M8 8V4h12v12h-4M4 8h12v12H4z',
  search: 'M20 20l-5-5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
  back: 'M14 5l-7 7 7 7',
  forward: 'M10 5l7 7-7 7',
  up: 'M5 14l7-7 7 7',
  down: 'M5 9l7 7 7-7',
  refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  folder: 'M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h7v3',
  file: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6',
  notepad: 'M6 3h14v18H6zM3 6h5M3 10h5M3 14h5M3 18h5M11 8h6M11 12h6M11 16h4',
  settings:
    'M10 3h4l1 3 3 1 2 3v4l-3 1-1 3-3 2h-4l-1-3-3-1-2-3v-4l3-1 1-3zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  browser: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18',
  calculator: 'M5 2h14v20H5zM8 5h8v4H8zM8 13h1m3 0h1m3 0h1M8 17h1m3 0h1m3 0h1',
  paint: 'M14 4c8 0 10 11 4 11h-3l-2 3c-1 3-10 2-10-6 0-5 5-8 11-8M8 8h.1M13 7h.1M17 10h.1M7 13h.1',
  photos: 'M3 4h18v16H3zM3 17l6-6 5 5 3-3 4 4M16 8h.1',
  terminal: 'M3 4h18v16H3zM6 9l3 3-3 3M12 16h5',
  media: 'M8 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  chart: 'M3 3v18h18M7 16v-4m5 4V7m5 9v-6',
  trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  computer: 'M3 3h18v13H3zM12 16v5M7 21h10',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  copy: 'M9 8h12v13H9zM5 16H3V3h12v2',
  cut: 'M6 8l13 13M6 16 19 3M6 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  paste: 'M8 5H4v16h16V5h-4M9 3h6v5H9z',
  plus: 'M12 4v16M4 12h16',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  check: 'M4 12l5 5L20 6',
  external: 'M14 3h7v7M21 3 10 14M10 5H4v15h15v-6',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  unlock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0',
  wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.1',
  volume: 'M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  notification: 'M3 3h18v14h-7l-4 4v-4H3z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 6 0 0 1 16 0v2',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  info: 'M12 11v6M12 7h.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  heart: 'M12 21 3 12C-2 4 7-1 12 6c5-7 14-2 9 6z',
  rename: 'M4 17V5h9M4 17h7M16 3v18M13 3h6M13 21h6',
  desktop: 'M3 4h18v13H3zM8 21h8M12 17v4',
  book: 'M12 5C9 3 5 3 2 4v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1zM12 5v16',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3',
  more: 'M5 12h.1M12 12h.1M19 12h.1',
  star: 'M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  network: 'M9 3h6v6H9zM3 16h6v6H3zM15 16h6v6h-6zM12 9v4M6 16v-3h12v3',
};
export function Icon({
  name,
  size = 20,
  color,
  className = '',
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  if (name === 'logo')
    return (
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={style}
        fill={color || 'currentColor'}
      >
        <path d="M2 3l9-1v9H2zm11-1 9-1v10h-9zM2 13h9v9l-9-1zm11 0h9v10l-9-1z" />
      </svg>
    );
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d={paths[name] ?? paths.file} />
    </svg>
  );
}
export function AppIcon({
  name,
  color,
  size = 38,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  return (
    <span
      className={`app-icon app-icon-${name}`}
      style={
        {
          width: size,
          height: size,
          color: color || 'var(--accent)',
          '--icon-color': color || 'var(--accent)',
        } as CSSProperties
      }
    >
      <Icon name={name} size={size * 0.78} />
    </span>
  );
}
