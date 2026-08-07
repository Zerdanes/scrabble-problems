/**
 * Fabrique l'icone de l'application : un jeton de Scrabble.
 *
 *   app/icon.ico   raccourci Bureau et barre des taches (7 tailles)
 *   app/icon.png   favicon de la fenetre
 *
 * Aucune bibliotheque : le dessin est fait au pixel, le PNG et l'ICO sont
 * encodes ici. Le S est trace par distance a deux arcs de cercle, ce qui donne
 * un trait net a n'importe quelle taille — une image toute faite serait floue en
 * 256 et illisible en 16.
 *
 *   node build/make-icon.js
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'app');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 4;

// Couleurs du jeton, reprises de la feuille de style.
const IVORY_LIGHT = [0xfd, 0xf4, 0xdf];
const IVORY_DARK = [0xe4, 0xcd, 0x96];
const INK = [0x3b, 0x2a, 0x14];
const EDGE = [0xb9, 0x9c, 0x5c];

// ------------------------------------------------------------------ geometrie

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Distance signee a un rectangle aux coins arrondis, centre en (0,0). */
function roundedRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** L'angle est-il sur l'arc allant de `start` a `end` dans le sens direct ? */
function onArc(angle, start, end) {
  const span = (((end - start) % 360) + 360) % 360;
  const rel = (((angle - start) % 360) + 360) % 360;
  return rel <= span;
}

/** Distance a un arc de cercle ; au-dela des extremites, distance au bout. */
function distanceToArc(px, py, cx, cy, radius, start, end) {
  const angle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  if (onArc(angle, start, end)) return Math.abs(Math.hypot(px - cx, py - cy) - radius);
  const point = (deg) => [cx + radius * Math.cos((deg * Math.PI) / 180), cy + radius * Math.sin((deg * Math.PI) / 180)];
  const [sx, sy] = point(start);
  const [ex, ey] = point(end);
  return Math.min(Math.hypot(px - sx, py - sy), Math.hypot(px - ex, py - ey));
}

/**
 * Distance au trace du S. Deux cercles tangents au centre du jeton : celui du
 * haut parcouru de 30 a 270 degres, celui du bas de 210 a 90. Ils se rejoignent
 * exactement au point central, le trait est donc continu.
 */
function distanceToS(px, py) {
  const offset = 0.113;
  const radius = 0.113;
  const upper = distanceToArc(px, py, 0, offset, radius, 30, 270);
  const lower = distanceToArc(px, py, 0, -offset, radius, 210, 90);
  return Math.min(upper, lower);
}

/** Le petit 1 en bas a droite, omis aux tailles ou il ne serait qu'une bavure. */
function distanceToOne(px, py) {
  // Attention : py pointe vers le haut. Le sommet du chiffre est donc en by + h
  // et son empattement en by - h.
  const bx = 0.305;
  const by = -0.3;
  const h = 0.068;
  return Math.min(
    distanceToSegment(px, py, bx, by - h, bx, by + h), // fut
    distanceToSegment(px, py, bx - 0.05, by + h * 0.42, bx, by + h), // attaque
    distanceToSegment(px, py, bx - 0.055, by - h, bx + 0.055, by - h) // empattement
  );
}

// ------------------------------------------------------------------- rendu

function renderTile(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const aa = 0.85 / (size * SUPERSAMPLE); // largeur d'un sous-pixel
  const withDigit = size >= 48;
  const strokeS = size >= 32 ? 0.043 : 0.05; // trait un peu plus gras en tres petit
  const strokeOne = 0.016;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          // Coordonnees centrees dans [-0.5, 0.5], y vers le haut.
          const px = (x + (sx + 0.5) / SUPERSAMPLE) / size - 0.5;
          const py = 0.5 - (y + (sy + 0.5) / SUPERSAMPLE) / size;

          const tile = roundedRect(px, py, 0.455, 0.455, 0.105);
          const inside = smoothstep(aa, -aa, tile);
          if (inside <= 0) continue;

          // Degrade diagonal, puis liseré plus sombre sur le pourtour.
          const t = clamp01((0.5 - px + (0.5 - py)) / 2);
          let cr = mix(IVORY_LIGHT[0], IVORY_DARK[0], t);
          let cg = mix(IVORY_LIGHT[1], IVORY_DARK[1], t);
          let cb = mix(IVORY_LIGHT[2], IVORY_DARK[2], t);

          const rim = smoothstep(-0.035, -0.008, tile);
          cr = mix(cr, EDGE[0], rim * 0.75);
          cg = mix(cg, EDGE[1], rim * 0.75);
          cb = mix(cb, EDGE[2], rim * 0.75);

          // Lettre.
          let glyph = smoothstep(strokeS + aa, strokeS - aa, distanceToS(px, py));
          if (withDigit) {
            glyph = Math.max(glyph, smoothstep(strokeOne + aa, strokeOne - aa, distanceToOne(px, py)));
          }
          cr = mix(cr, INK[0], glyph);
          cg = mix(cg, INK[1], glyph);
          cb = mix(cb, INK[2], glyph);

          r += cr * inside;
          g += cg * inside;
          b += cb * inside;
          a += inside;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / samples) * 255);
    }
  }
  return pixels;
}

// -------------------------------------------------------------- encodage PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 6; // RGBA
  // compression, filtre et entrelacement restent a 0

  // Chaque ligne est prefixee de son octet de filtre (0 = aucun).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------- encodage ICO

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserve
  header.writeUInt16LE(1, 2); // 1 = icone
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size; // 0 signifie 256
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette
    directory[entry + 3] = 0; // reserve
    directory.writeUInt16LE(1, entry + 4); // plans
    directory.writeUInt16LE(32, entry + 6); // bits par pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

// ------------------------------------------------------------------ execution

const images = SIZES.map((size) => ({ size, data: encodePng(renderTile(size), size) }));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(images));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images.find((image) => image.size === 256).data);

const ico = fs.statSync(path.join(OUT_DIR, 'icon.ico'));
console.log(`icon.ico  ${SIZES.join(', ')} px  ${(ico.size / 1024).toFixed(1)} Ko`);
console.log(`icon.png  256 px  ${(images.at(-1).data.length / 1024).toFixed(1)} Ko`);
