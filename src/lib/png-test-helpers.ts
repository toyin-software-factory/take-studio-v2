import { inflateSync } from "node:zlib";

/** A decoded 8 bit RGBA image: `data` holds `width * height * 4` bytes, row by row. */
export type Rgba = { readonly width: number; readonly height: number; readonly data: Uint8Array };

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Reads a non interlaced 8 bit RGBA PNG with Node's zlib only (test helper: it proves what the
 * committed credit image holds, spec 0026 AC-1). Throws on anything else.
 */
export function decodePng(file: Uint8Array): Rgba {
  const buf = Buffer.from(file);
  if (buf.subarray(1, 4).toString("latin1") !== "PNG") throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("latin1");
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0) throw new Error("need 8 bit RGBA");
    } else if (type === "IDAT") parts.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (out[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= 4 ? (out[(y - 1) * stride + x - 4] ?? 0) : 0;
      const add =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, upLeft);
      out[y * stride + x] = (cur + add) & 255;
    }
  }
  return { width, height, data: out };
}

export const pixelAt = (
  img: Rgba,
  x: number,
  y: number,
): readonly [number, number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
};
