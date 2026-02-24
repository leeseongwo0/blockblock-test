const COLOR_PALETTES: Array<[string, string, string, string]> = [
  ['#14213d', '#fca311', '#e5e5e5', '#ffffff'],
  ['#2b2d42', '#ef233c', '#8d99ae', '#edf2f4'],
  ['#073b4c', '#06d6a0', '#ffd166', '#ef476f'],
  ['#0b132b', '#5bc0be', '#1c2541', '#c3f0ca'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#3a0ca3', '#4361ee', '#4cc9f0', '#f1faee'],
];

function hashKeyword(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function normalizeKeyword(rawKeyword: string): string {
  return rawKeyword.trim().replace(/\s+/g, ' ');
}

export function keywordToNftName(keyword: string): string {
  const base = `${keyword} Booth NFT`;
  return base.slice(0, 48);
}

export function renderKeywordSvg(keyword: string): string {
  const seed = hashKeyword(keyword.toLowerCase());
  const palette = COLOR_PALETTES[seed % COLOR_PALETTES.length];
  const [bgA, bgB, accentA, accentB] = palette;

  const circles: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((seed >> (i * 3)) % 360) * (Math.PI / 180);
    const radius = 120 + ((seed >> (i * 4 + 1)) % 180);
    const cx = 512 + Math.cos(angle) * 260;
    const cy = 512 + Math.sin(angle) * 260;
    const size = 90 + ((seed >> (i * 5 + 2)) % 110);
    const fill = i % 2 === 0 ? accentA : accentB;
    circles.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${size}" fill="${fill}" fill-opacity="0.26" />`,
    );
  }

  const escapedKeyword = escapeXml(keyword);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '<defs>',
    `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="${bgA}" />`,
    `<stop offset="100%" stop-color="${bgB}" />`,
    '</linearGradient>',
    '<filter id="blur"><feGaussianBlur stdDeviation="24" /></filter>',
    '</defs>',
    '<rect width="1024" height="1024" fill="url(#bg)" />',
    `<g filter="url(#blur)">${circles.join('')}</g>`,
    '<rect x="84" y="760" width="856" height="180" rx="32" fill="#0f172acc" />',
    '<text x="120" y="840" fill="#f8fafc" font-family="IBM Plex Sans, Pretendard, sans-serif" font-size="36">',
    'BLOCKBLOCK DEMO',
    '</text>',
    `<text x="120" y="895" fill="#ffffff" font-family="IBM Plex Sans, Pretendard, sans-serif" font-size="58" font-weight="700">`,
    escapedKeyword,
    '</text>',
    '</svg>',
  ].join('');
}
