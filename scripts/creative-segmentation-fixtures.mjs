// Deterministic segmentation fixture generator (P2a follow-up). Builds
// the 12-category evaluation set as synthetic PNGs with known geometry:
// every mask expectation is computable, and human review columns stay
// explicit in the corpus. No network, no models, no randomness beyond a
// seeded PRNG for the clutter case.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = process.argv[2] ?? "evaluation/creative-segmentation-v1/fixtures";
await mkdir(OUT, { recursive: true });

function lcg(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function flat(size, color) {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer();
}

async function save(name, buffer) {
  await writeFile(`${OUT}/${name}.png`, buffer);
  console.log(`fixture ${name}`);
}

const S = 512;
const rand = lcg(231);

const cases = {
  "plain-backdrop": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(30,60,120)"/></svg>`),
    }]).png().toBuffer();
  },
  "dark-on-dark": async () => {
    const bg = await flat(S, { r: 24, g: 24, b: 28 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(8,8,12)"/></svg>`),
    }]).png().toBuffer();
  },
  "white-on-white": async () => {
    const bg = await flat(S, { r: 255, g: 255, b: 255 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(248,248,250)"/></svg>`),
    }]).png().toBuffer();
  },
  "translucent-packaging": async () => {
    const bg = await flat(S, { r: 235, g: 240, b: 245 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(30,60,120)" fill-opacity="0.45"/></svg>`),
    }]).png().toBuffer();
  },
  "reflective-packaging": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(20,40,90)"/><stop offset="0.5" stop-color="rgb(150,180,230)"/><stop offset="1" stop-color="rgb(20,40,90)"/></linearGradient></defs>`;
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}">${gradient}<rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="url(#g)"/></svg>`),
    }]).png().toBuffer();
  },
  "thin-edges": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const lines = Array.from({ length: 9 }, (_, i) => {
      const y = 60 + i * 44;
      return `<rect x="120" y="${y}" width="272" height="6" fill="rgb(30,60,120)"/>`;
    }).join("");
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}">${lines}</svg>`),
    }]).png().toBuffer();
  },
  "hair-fine-edges": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    let paths = "";
    for (let i = 0; i < 24; i += 1) {
      const x = 150 + i * 8;
      paths += `<path d="M${x} 120 Q ${x + 30} 300 ${x - 10} 420" stroke="rgb(40,30,20)" stroke-width="3" fill="none"/>`;
    }
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}">${paths}<ellipse cx="256" cy="430" rx="90" ry="40" fill="rgb(40,30,20)"/></svg>`),
    }]).png().toBuffer();
  },
  "product-shadow": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([
      { input: Buffer.from(`<svg width="${S}" height="${S}"><ellipse cx="300" cy="430" rx="150" ry="26" fill="rgb(120,120,125)" fill-opacity="0.55"/></svg>`) },
      { input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="120" width="${box}" height="${box}" rx="24" fill="rgb(30,60,120)"/></svg>`) },
    ]).png().toBuffer();
  },
  "hand-held": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    return sharp(bg).composite([
      { input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="150" y="120" width="212" height="300" rx="40" fill="rgb(210,150,110)"/></svg>`) },
      { input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="216" y="200" width="80" height="140" rx="16" fill="rgb(30,60,120)"/></svg>`) },
    ]).png().toBuffer();
  },
  "cluttered-background": async () => {
    const parts = [];
    for (let i = 0; i < 40; i += 1) {
      const x = Math.floor(rand() * (S - 60));
      const y = Math.floor(rand() * (S - 60));
      const c = [Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)];
      parts.push(`<rect x="${x}" y="${y}" width="60" height="60" fill="rgb(${c[0]},${c[1]},${c[2]})" fill-opacity="0.7"/>`);
    }
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const box = Math.floor(S / 3);
    const off = Math.floor((S - box) / 2);
    return sharp(bg).composite([
      { input: Buffer.from(`<svg width="${S}" height="${S}">${parts.join("")}</svg>`) },
      { input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(30,60,120)"/></svg>`) },
    ]).png().toBuffer();
  },
  "arabic-packaging": async () => {
    const bg = await flat(S, { r: 240, g: 240, b: 235 });
    const box = Math.floor(S / 2.4);
    const off = Math.floor((S - box) / 2);
    const bands = [0, 1, 2, 3].map((i) => {
      const y = off + 40 + i * 52;
      const w = box - 80 - i * 24;
      return `<rect x="${off + 40}" y="${y}" width="${w}" height="26" fill="rgb(20,40,80)"/>`;
    }).join("");
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${Math.floor(box * 1.2)}" rx="12" fill="rgb(250,250,248)"/><rect x="${off}" y="${off}" width="${box}" height="${Math.floor(box * 1.2)}" rx="12" fill="none" stroke="rgb(30,60,120)" stroke-width="6"/>${bands}</svg>`),
    }]).png().toBuffer();
  },
  "english-packaging": async () => {
    const bg = await flat(S, { r: 235, g: 238, b: 242 });
    const box = Math.floor(S / 2.4);
    const off = Math.floor((S - box) / 2);
    const bands = [0, 1, 2].map((i) => {
      const y = off + 44 + i * 58;
      return `<rect x="${off + 44}" y="${y}" width="${box - 88}" height="30" fill="rgb(120,20,20)"/>`;
    }).join("");
    return sharp(bg).composite([{
      input: Buffer.from(`<svg width="${S}" height="${S}"><rect x="${off}" y="${off}" width="${box}" height="${Math.floor(box * 1.2)}" rx="12" fill="rgb(252,252,250)"/><rect x="${off}" y="${off}" width="${box}" height="${Math.floor(box * 1.2)}" rx="12" fill="none" stroke="rgb(120,20,20)" stroke-width="6"/>${bands}</svg>`),
    }]).png().toBuffer();
  },
};

for (const [name, build] of Object.entries(cases)) {
  await save(name, await build());
}
console.log("fixtures complete");
