import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

type PngImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

type Template = {
  name: string;
  grid: boolean[][];
};

type LoadedAssets = {
  baseCoin: PngImage;
  templates: Template[];
};

const SYMBOL_PALETTES: Array<[string, string, string]> = [
  ['#7a3e16', '#c56a2a', '#f2b45b'],
  ['#5d2f14', '#9f5a2a', '#d88d4a'],
  ['#8a3a24', '#c7703e', '#f2af67'],
  ['#5b3922', '#98613a', '#d69963'],
  ['#6f4019', '#b66b2f', '#f0bc70'],
];

const CANVAS_SIZE = 512;
const COIN_SIZE = 448;
const LOW_RES = 64;
const GRID_SIZE = 16;
const CELL_SIZE = 3;
const SYMBOL_OFFSET = 8;

let loadedAssetsPromise: Promise<LoadedAssets> | null = null;

function hashKeyword(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toLowerSafe(input: string): string {
  return input.toLowerCase().trim();
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function createEmptyImage(width: number, height: number): PngImage {
  return {
    width,
    height,
    data: new Uint8Array(width * height * 4),
  };
}

function setPixel(
  image: PngImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return;
  }
  const offset = (y * image.width + x) * 4;
  image.data[offset] = r;
  image.data[offset + 1] = g;
  image.data[offset + 2] = b;
  image.data[offset + 3] = a;
}

function alphaBlend(dst: PngImage, src: PngImage, left: number, top: number) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const dstX = left + x;
      const dstY = top + y;
      if (dstX < 0 || dstY < 0 || dstX >= dst.width || dstY >= dst.height) {
        continue;
      }

      const srcOffset = (y * src.width + x) * 4;
      const dstOffset = (dstY * dst.width + dstX) * 4;

      const srcA = src.data[srcOffset + 3] / 255;
      if (srcA <= 0) {
        continue;
      }

      const dstA = dst.data[dstOffset + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) {
        continue;
      }

      const srcR = src.data[srcOffset];
      const srcG = src.data[srcOffset + 1];
      const srcB = src.data[srcOffset + 2];
      const dstR = dst.data[dstOffset];
      const dstG = dst.data[dstOffset + 1];
      const dstB = dst.data[dstOffset + 2];

      dst.data[dstOffset] = Math.round((srcR * srcA + dstR * dstA * (1 - srcA)) / outA);
      dst.data[dstOffset + 1] = Math.round((srcG * srcA + dstG * dstA * (1 - srcA)) / outA);
      dst.data[dstOffset + 2] = Math.round((srcB * srcA + dstB * dstA * (1 - srcA)) / outA);
      dst.data[dstOffset + 3] = Math.round(outA * 255);
    }
  }
}

function fillRect(
  image: PngImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  const [r, g, b, a] = color;
  for (let yy = 0; yy < height; yy += 1) {
    for (let xx = 0; xx < width; xx += 1) {
      setPixel(image, x + xx, y + yy, r, g, b, a);
    }
  }
}

function resizeNearest(source: PngImage, targetWidth: number, targetHeight: number): PngImage {
  const out = createEmptyImage(targetWidth, targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(
      source.height - 1,
      Math.floor((y * source.height) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(
        source.width - 1,
        Math.floor((x * source.width) / targetWidth),
      );
      const srcOffset = (srcY * source.width + srcX) * 4;
      const dstOffset = (y * targetWidth + x) * 4;
      out.data[dstOffset] = source.data[srcOffset];
      out.data[dstOffset + 1] = source.data[srcOffset + 1];
      out.data[dstOffset + 2] = source.data[srcOffset + 2];
      out.data[dstOffset + 3] = source.data[srcOffset + 3];
    }
  }
  return out;
}

function readPng(filePath: string): PngImage {
  const parsed = PNG.sync.read(fs.readFileSync(filePath));
  return {
    width: parsed.width,
    height: parsed.height,
    data: new Uint8Array(parsed.data),
  };
}

function toPngBuffer(image: PngImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

function resolveAssetPath(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), '..', relativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Missing asset: ${relativePath}`);
}

function resolveFirstExistingAssetPath(relativePaths: string[]): string {
  for (const relativePath of relativePaths) {
    try {
      return resolveAssetPath(relativePath);
    } catch {
      // Keep searching through fallback paths.
    }
  }
  throw new Error(`Missing asset. Tried: ${relativePaths.join(', ')}`);
}

function resolveAssetDir(relativePath: string): string {
  const filePath = resolveAssetPath(relativePath);
  if (!fs.statSync(filePath).isDirectory()) {
    throw new Error(`Asset path is not a directory: ${relativePath}`);
  }
  return filePath;
}

function extractGridFromReference(referenceImage: PngImage): boolean[][] {
  const normalized = resizeNearest(referenceImage, LOW_RES, LOW_RES);
  const grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false),
  );

  const center = LOW_RES / 2;
  const maxRadius = 18;

  for (let gy = 0; gy < GRID_SIZE; gy += 1) {
    for (let gx = 0; gx < GRID_SIZE; gx += 1) {
      let hits = 0;
      for (let py = 0; py < 4; py += 1) {
        for (let px = 0; px < 4; px += 1) {
          const x = gx * 4 + px;
          const y = gy * 4 + py;
          const dx = x - center;
          const dy = y - center;
          if (Math.sqrt(dx * dx + dy * dy) > maxRadius) {
            continue;
          }

          const offset = (y * LOW_RES + x) * 4;
          const r = normalized.data[offset];
          const g = normalized.data[offset + 1];
          const b = normalized.data[offset + 2];
          const a = normalized.data[offset + 3];
          if (a < 20) {
            continue;
          }

          const brightness = (r + g + b) / 3;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          const isCoinStroke = r > g + 8 && g > b + 6 && saturation > 20 && brightness < 170;
          const isDarkStroke = brightness < 85;

          if (isCoinStroke || isDarkStroke) {
            hits += 1;
          }
        }
      }
      grid[gy][gx] = hits >= 4;
    }
  }

  const cleaned = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false),
  );
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!grid[y][x]) {
        continue;
      }
      let neighbors = 0;
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          if (yy === 0 && xx === 0) {
            continue;
          }
          const ny = y + yy;
          const nx = x + xx;
          if (ny < 0 || nx < 0 || ny >= GRID_SIZE || nx >= GRID_SIZE) {
            continue;
          }
          if (grid[ny][nx]) {
            neighbors += 1;
          }
        }
      }
      cleaned[y][x] = neighbors >= 1;
    }
  }

  return cleaned;
}

function fallbackGrid(seed: number): boolean[][] {
  const grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false),
  );
  const center = (GRID_SIZE - 1) / 2;
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);
      const diamond = dx + dy <= 5;
      const ring = dx + dy >= 3;
      const sprinkle = ((x * 31 + y * 17 + seed) % 9) <= 2;
      grid[y][x] = diamond && ring && sprinkle;
    }
  }
  return grid;
}

function chooseTemplateByKeyword(keyword: string, templates: Template[], seed: number): Template {
  const lowered = toLowerSafe(keyword);
  const preferredMap: Array<{ tokens: string[]; nameHint: string }> = [
    { tokens: ['dog', 'doge', 'puppy', '강아지', '개', '도지'], nameHint: 'paw' },
    { tokens: ['rabbit', 'bunny', '토끼'], nameHint: 'rabbit' },
    { tokens: ['bear', '곰'], nameHint: 'bear' },
    { tokens: ['bee', '꿀벌', '벌'], nameHint: 'bee' },
    { tokens: ['panda', '판다'], nameHint: 'panda' },
    { tokens: ['heart', 'love', '하트', '사랑'], nameHint: 'heart' },
    { tokens: ['sprout', 'leaf', 'plant', '새싹', '잎'], nameHint: 'sprout' },
  ];

  for (const preferred of preferredMap) {
    if (!preferred.tokens.some((token) => lowered.includes(token))) {
      continue;
    }
    const found = templates.find((template) => template.name.includes(preferred.nameHint));
    if (found) {
      return found;
    }
  }

  return templates[seed % templates.length];
}

function drawKeywordSymbol(grid: boolean[][], seed: number): PngImage {
  const image = createEmptyImage(LOW_RES, LOW_RES);
  const palette = SYMBOL_PALETTES[seed % SYMBOL_PALETTES.length];
  const dark = parseHex(palette[0]);
  const mid = parseHex(palette[1]);
  const light = parseHex(palette[2]);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!grid[y][x]) {
        continue;
      }
      const top = y > 0 && grid[y - 1][x];
      const right = x < GRID_SIZE - 1 && grid[y][x + 1];
      const bottom = y < GRID_SIZE - 1 && grid[y + 1][x];
      const left = x > 0 && grid[y][x - 1];
      const edgeCount = Number(top) + Number(right) + Number(bottom) + Number(left);
      const shade = edgeCount <= 2 ? dark : ((x * 13 + y * 7 + seed) % 3 === 0 ? light : mid);

      fillRect(
        image,
        SYMBOL_OFFSET + x * CELL_SIZE,
        SYMBOL_OFFSET + y * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE,
        [shade[0], shade[1], shade[2], 232],
      );
    }
  }

  return image;
}

function composeCoinImage(baseCoin: PngImage, symbol: PngImage): PngImage {
  const coin = createEmptyImage(baseCoin.width, baseCoin.height);
  alphaBlend(coin, baseCoin, 0, 0);
  alphaBlend(coin, symbol, 0, 0);

  const upscaledCoin = resizeNearest(coin, COIN_SIZE, COIN_SIZE);
  const canvas = createEmptyImage(CANVAS_SIZE, CANVAS_SIZE);
  fillRect(canvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE, [255, 255, 255, 255]);
  alphaBlend(
    canvas,
    upscaledCoin,
    Math.floor((CANVAS_SIZE - COIN_SIZE) / 2),
    Math.floor((CANVAS_SIZE - COIN_SIZE) / 2),
  );
  return canvas;
}

async function loadAssets(): Promise<LoadedAssets> {
  const basePath = resolveFirstExistingAssetPath([
    'assets/coin/coin_base_64x64.png',
    'assets/coin/coin_base_64x64.png.png',
  ]);
  const baseCoinRaw = readPng(basePath);
  const baseCoin = resizeNearest(baseCoinRaw, LOW_RES, LOW_RES);

  const examplesDir = resolveAssetDir('assets/coin_examples');
  const templateFiles = fs
    .readdirSync(examplesDir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort();
  if (templateFiles.length === 0) {
    throw new Error('No style reference images found in assets/coin_examples');
  }

  const templates = templateFiles.map((filename) => {
    const reference = readPng(path.join(examplesDir, filename));
    return {
      name: filename.toLowerCase(),
      grid: extractGridFromReference(reference),
    };
  });

  return {
    baseCoin,
    templates,
  };
}

async function getAssets(): Promise<LoadedAssets> {
  if (!loadedAssetsPromise) {
    loadedAssetsPromise = loadAssets();
  }
  return loadedAssetsPromise;
}

export function normalizeKeyword(rawKeyword: string): string {
  return rawKeyword.trim().replace(/\s+/g, ' ');
}

export function keywordToNftName(keyword: string): string {
  const base = `${keyword} Booth NFT`;
  return base.slice(0, 48);
}

export async function renderKeywordCoinPng(keyword: string): Promise<Buffer> {
  const assets = await getAssets();
  const seed = hashKeyword(keyword.toLowerCase());
  const template = chooseTemplateByKeyword(keyword, assets.templates, seed);
  const isEmpty = template.grid.every((row) => row.every((cell) => !cell));
  const grid = isEmpty ? fallbackGrid(seed) : template.grid;
  const symbol = drawKeywordSymbol(grid, seed);
  const composed = composeCoinImage(assets.baseCoin, symbol);
  return toPngBuffer(composed);
}

export async function renderKeywordCoinDataUrl(keyword: string): Promise<string> {
  const png = await renderKeywordCoinPng(keyword);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function resolvePixelCoinEstimateUsd(volume: number) {
  const normalized = Math.max(1, Math.floor(volume));
  return {
    low: Number((normalized * 0.011).toFixed(2)),
    medium: Number((normalized * 0.042).toFixed(2)),
    high: Number((normalized * 0.167).toFixed(2)),
  };
}

export function recommendImageModel(eventVolume: number): 'gpt-image-1' | 'gpt-image-1.5' {
  if (eventVolume <= 1500) {
    return 'gpt-image-1';
  }
  return 'gpt-image-1.5';
}
