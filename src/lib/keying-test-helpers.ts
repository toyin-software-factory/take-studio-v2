import { type RawFrame, type Rgb } from "./keying";

export const W = 320;
export const H = 180;
/** A frame of one colour, with optional rectangles (fractions of the frame) of other colours. */
export function frame(
  base: Rgb,
  boxes: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; color: Rgb }> = [],
  size = { width: W, height: H },
): RawFrame {
  const data = new Uint8Array(size.width * size.height * 3);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const fx = x / size.width;
      const fy = y / size.height;
      const box = boxes.find((b) => fx >= b.x0 && fx < b.x1 && fy >= b.y0 && fy < b.y1);
      const c = box?.color ?? base;
      const i = (y * size.width + x) * 3;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
    }
  }
  return { width: size.width, height: size.height, data };
}
