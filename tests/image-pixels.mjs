import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";

// Decode Chromium's eight-bit RGB/RGBA screenshots without an extra test dependency.
function decode(png) {
  let offset = 8,
    width,
    height,
    channels;
  const chunks = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset),
      type = png.toString("ascii", offset + 4, offset + 8),
      data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert([2, 6].includes(data[9]));
      assert.equal(data[12], 0);
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    pixels = new Uint8Array(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x,
        left = x >= channels ? pixels[at - channels] : 0,
        up = y ? pixels[at - stride] : 0,
        corner = y && x >= channels ? pixels[at - stride - channels] : 0;
      const predictor = [
        0,
        left,
        up,
        Math.floor((left + up) / 2),
        paeth(left, up, corner),
      ][filter];
      pixels[at] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}

export function comparePixels(expectedPNG, actualPNG) {
  const expected = decode(expectedPNG),
    actual = decode(actualPNG);
  assert(
    Math.abs(expected.width - actual.width) <= 1 &&
      Math.abs(expected.height - actual.height) <= 1,
    `Rendered image dimensions differ: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`,
  );
  const width = Math.min(expected.width, actual.width),
    height = Math.min(expected.height, actual.height);
  let sum = 0,
    samples = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(
          expected.pixels[(y * expected.width + x) * expected.channels + c] -
            actual.pixels[(y * actual.width + x) * actual.channels + c],
        );
        samples++;
      }
  return { width, height, meanError: sum / samples };
}
