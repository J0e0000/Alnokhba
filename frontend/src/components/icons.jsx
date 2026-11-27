/**
 * ONE professional line-icon set for the whole app + landing (note #9-1):
 * inline SVG, Lucide-style outline — 24×24 grid, stroke 2, round caps and
 * joins, currentColor. Replaces the emoji-style icons (💳 🎨 🖨️ ✨ ◔ ↺ ⧖
 * ♧ ▦ ✎ ↗ ⚙ …) everywhere; accessible labels stay in the markup.
 *
 * Usage: <Icon name="credit-card" size={18} className="..." />
 * The component renders a decorative <svg aria-hidden> by default — put the
 * text label next to it (or an aria-label on the button) as before.
 */

// 24×24 outline geometry (Lucide icon set), stroke-based
const ICONS = {
  'credit-card': { rect: [2, 5, 20, 14, 2], lines: [[2, 10, 22, 10], [6, 15, 10, 15]] },
  palette: { paths: ['M12 22a10 10 0 1 1 10-10c0 2.2-1.8 4-4 4h-2a2 2 0 0 0-2 2c0 .6.2 1 .5 1.4.3.4.5.9.5 1.4 0 1-.8 1.2-3 1.2Z'], circles: [[7.5, 10.5, .5], [12, 7.5, .5], [16.5, 10.5, .5]] },
  printer: { paths: ['M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 9V3h12v6', 'M6 14h12v7H6Z'] },
  sparkles: { paths: ['M9.9 3.6 11.3 8a1 1 0 0 0 .7.7l4.4 1.4a1 1 0 0 1 0 1.9L12 13.3a1 1 0 0 0-.7.7l-1.4 4.4a1 1 0 0 1-1.9 0L6.7 14a1 1 0 0 0-.7-.7L1.6 12a1 1 0 0 1 0-1.9L6 8.7a1 1 0 0 0 .7-.7l1.4-4.4a1 1 0 0 1 1.8 0Z', 'M20 3v4', 'M22 5h-4', 'M17 17v4', 'M19 19h-4'] },
  clock: { circle: [12, 12, 10], paths: ['M12 6v6l4 2'] },
  history: { paths: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'] },
  'rotate-ccw': { paths: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'] },
  trophy: { paths: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'] },
  'layout-dashboard': { rects: [[3, 3, 7, 9, 1], [14, 3, 7, 5, 1], [14, 12, 7, 9, 1], [3, 16, 7, 5, 1]] },
  pencil: { paths: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.108a.5.5 0 0 0 .623.622l4.108-1.32a2 2 0 0 0 .83-.497Z', 'M15 5l4 4'] },
  'arrow-up-right': { paths: ['M7 7h10v10', 'M7 17 17 7'] },
  settings: { paths: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z'], circle: [12, 12, 3] },
  bell: { paths: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'] },
  users: { paths: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], circle: [9, 7, 4] },
  'file-text': { paths: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'] },
  smartphone: { rect: [5, 2, 14, 20, 2], paths: ['M12 18h.01'] },
  rocket: { paths: ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z', 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0', 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'] },
  calendar: { rect: [3, 4, 18, 18, 2], paths: ['M16 2v4', 'M8 2v4', 'M3 10h18'] },
  'clipboard-list': { paths: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'], rects: [[8, 2, 8, 4, 1]], lines: [[12, 11, 12, 11], [8, 11, 16, 11], [8, 15, 13, 15]] },
  plus: { paths: ['M5 12h14', 'M12 5v14'] },
  x: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  'chevron-left': { paths: ['m15 18-6-6 6-6'] },
  'chevron-right': { paths: ['m9 18 6-6-6-6'] },
  'chevron-down': { paths: ['m6 9 6 6 6-6'] },
  'more-horizontal': { circles: [[5, 12, 1], [12, 12, 1], [19, 12, 1]] },
  search: { circle: [11, 11, 8], paths: ['m21 21-4.3-4.3'] },
  filter: { paths: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3Z'] },
  download: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
  trash: { paths: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'] },
  phone: { paths: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z'] },
  send: { paths: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'] },
  eye: { paths: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z'], circle: [12, 12, 3] },
  star: { paths: ['M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.123 2.123 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16Z'] },
  'alert-circle': { circle: [12, 12, 10], paths: ['M12 8v4', 'M12 16h.01'] },
  info: { circle: [12, 12, 10], paths: ['M12 16v-4', 'M12 8h.01'] },
  wallet: { paths: ['M21 12V7H5a2 2 0 0 1 0-4h14v4', 'M3 5v14a2 2 0 0 0 2 2h16v-5', 'M18 12a2 2 0 0 0 0 4h4v-4Z'] },
  'graduation-cap': { paths: ['M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0Z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'] },
  'bar-chart': { paths: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'] },
  target: { circle: [12, 12, 10], circle2: [12, 12, 6], circle3: [12, 12, 2] },
  lightbulb: { paths: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'] },
  home: { paths: ['M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-3v-7h-8v7H5a2 2 0 0 1-2-2Z'] },
  'log-out': { paths: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'] },
  menu: { lines: [[4, 6, 20, 6], [4, 12, 20, 12], [4, 18, 20, 18]] },
  user: { paths: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'], circle: [12, 8, 4] },
  image: { rect: [3, 3, 18, 18, 2], circle: [9, 9, 2], paths: ['m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'] },
  link: { paths: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'] },
  shield: { paths: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z'] },
  refresh: { paths: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'] },
  hourglass: { paths: ['M5 22h14', 'M5 2h14', 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22', 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'] },
  megaphone: { paths: ['m3 11 18-5v12L3 14v-3Z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'] },
  inbox: { paths: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z'] },
  'message-circle': { paths: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'] },
  'arrow-left': { paths: ['m12 19-7-7 7-7', 'M19 12H5'] },
  'arrow-right': { paths: ['M5 12h14', 'm12 5 7 7-7 7'] },
  'zoom-in': { circle: [11, 11, 8], paths: ['m21 21-4.3-4.3', 'M11 8v6', 'M8 11h6'] },
  copy: { rects: [[8, 8, 14, 14, 2]], paths: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'] },
  share: { paths: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'm16 6-4-4-4 4', 'M12 2v13'] },
  'share-2': { circle: [18, 5, 3], circle2: [6, 12, 3], circle3: [18, 19, 3], paths: ['m8.59 13.51 6.83 3.98', 'm15.41 6.51-6.82 3.98'] },
  scan: { paths: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 12h10'] },
  badge: { circle: [12, 8, 6], paths: ['M15.477 12.89 17 22l-5-3-5 3 1.523-9.11'] },
  'shield-check': { paths: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z', 'm9 12 2 2 4-4'] },
  'user-plus': { paths: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'], circle: [9, 7, 4], lines: [[19, 8, 19, 14], [22, 11, 16, 11]] },
  square: { rect: [4, 4, 16, 16, 2] },
  'check-square': { rect: [4, 4, 16, 16, 2], paths: ['m9 12 2 2 4-4'] },
  zap: { paths: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'] },
  sun: { circle: [12, 12, 4], paths: ['M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M6.34 17.66l-1.41 1.41', 'M19.07 4.93l-1.41 1.41'] },
  moon: { paths: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'] },
  'layers': { paths: ['M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'M22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'] },
  archive: { rects: [[2, 3, 20, 5, 1]], paths: ['M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'] },
  save: { paths: ['M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2Z', 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7', 'M7 3v4a1 1 0 0 0 1 1h7'] },
  pause: { rects: [[6, 4, 4, 16, 1], [14, 4, 4, 16, 1]] },
}

export default function Icon({ name, size = 20, strokeWidth = 2, className = '', style, label }) {
  const ic = ICONS[name]
  if (!ic) return null
  const stroke = { stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-0.15em', ...style }}
    >
      {ic.rects?.map((r, i) => <rect key={`r${i}`} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={r[4]} {...stroke} />)}
      {ic.rect && <rect x={ic.rect[0]} y={ic.rect[1]} width={ic.rect[2]} height={ic.rect[3]} rx={ic.rect[4]} {...stroke} />}
      {ic.circles?.map((c, i) => <circle key={`c${i}`} cx={c[0]} cy={c[1]} r={c[2]} {...stroke} />)}
      {ic.circle && <circle cx={ic.circle[0]} cy={ic.circle[1]} r={ic.circle[2]} {...stroke} />}
      {ic.circle2 && <circle cx={ic.circle2[0]} cy={ic.circle2[1]} r={ic.circle2[2]} {...stroke} />}
      {ic.circle3 && <circle cx={ic.circle3[0]} cy={ic.circle3[1]} r={ic.circle3[2]} {...stroke} />}
      {ic.paths?.map((d, i) => <path key={`p${i}`} d={d} {...stroke} />)}
      {ic.lines?.map((l, i) => <line key={`l${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} {...stroke} />)}
    </svg>
  )
}

export const IconNames = Object.keys(ICONS)

/** True when the given string is a known icon name (vs a legacy glyph). */
export function hasIcon(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name)
}
