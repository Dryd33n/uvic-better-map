// Floor plan icons: 24×24 monochrome glyphs in currentColor, as SVG markup for the HTML markers.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const man = `<circle cx="12" cy="4.5" r="2.2" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="M9.5 8h5a1.5 1.5 0 0 1 1.5 1.5V15h-1.8v7h-4.4v-7H8V9.5A1.5 1.5 0 0 1 9.5 8z"/>`;
const woman = `<circle cx="12" cy="4.5" r="2.2" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="M10 8h4l3.2 8.5h-3v5.5h-4.4v-5.5h-3z"/>`;

export const ICONS = {
  men: svg(man),
  women: svg(woman),
  allGender: svg(`<g transform="translate(-4.5 2) scale(0.85)">${man}</g><g transform="translate(8 2) scale(0.85)">${woman}</g>`),
  accessible: svg(`<circle cx="10" cy="4" r="2" fill="currentColor" stroke="none"/><path d="M10 7.5V14h6l3 6"/><path d="M7.5 10.5a5.5 5.5 0 1 0 7.8 6.5"/>`),
  elevator: svg(`<rect x="5" y="2.5" width="14" height="19" rx="2"/><path fill="currentColor" stroke="none" d="M12 5.5l3.2 4.5H8.8zM12 18.5l-3.2-4.5h6.4z"/>`),
  stairs: svg(`<path d="M3 20h5v-5h5v-5h5V5h3"/>`),
  food: svg(`<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M17 21V3c-2.5 1.5-3.5 5-3.5 8.5H17"/>`),
  aed: svg(`<path d="M12 20.5S3.5 15.5 3.5 9.2A4.4 4.4 0 0 1 12 6.8a4.4 4.4 0 0 1 8.5 2.4c0 6.3-8.5 11.3-8.5 11.3z"/><path fill="currentColor" stroke="none" d="M12.8 8.5l-3.6 5.2h2.7l-.9 4 3.6-5.3h-2.7z"/>`),
  naloxone: svg(`<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V4.5h6V7M12 10.5v6M9 13.5h6"/>`),
  shower: svg(`<path d="M5 21V9a4 4 0 0 1 8 0"/><path d="M9.5 10h7"/><circle cx="11" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="17.5" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="17.5" r="1" fill="currentColor" stroke="none"/>`),
  microwave: svg(`<rect x="2.5" y="5.5" width="19" height="13" rx="1.5"/><rect x="5.5" y="8.5" width="9" height="7" rx="0.5"/><path d="M18 9.5v.01M18 12.5v.01"/>`),
} as const;

export type IconName = keyof typeof ICONS;
