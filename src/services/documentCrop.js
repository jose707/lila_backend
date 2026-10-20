const sharp = require('sharp');

// Generous center crop for callers that request cropping without camera geometry.
const OCR_FALLBACK_CROP = { x: 0.1, y: 0.14, w: 0.8, h: 0.66 };

function parseCropRect(body, prefix) {
  if (!body || typeof body !== 'object') return null;
  const values = ['X', 'Y', 'W', 'H', 'ScreenW', 'ScreenH'].map(key =>
    Number.parseFloat(body[`${prefix}Crop${key}`]),
  );
  if (!values.every(Number.isFinite)) return null;
  const [x, y, w, h, screenW, screenH] = values;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || screenW <= 0 || screenH <= 0) return null;
  if ([x, y, w, h, screenW, screenH].some(value => value > 10000)) return null;
  if (x + w > screenW * 1.05 || y + h > screenH * 1.05) return null;
  return { x, y, w, h, screenW, screenH };
}

/**
 * Crop an image using the camera frame expressed in screen coordinates.
 * rect: { screenW, screenH, x, y, w, h }.
 */
async function cropForOcr(buffer, rect, margin = 0.1) {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return buffer;
    const imgW = meta.width;
    const imgH = meta.height;
    let norm;
    if (rect) {
      const { screenW, screenH, x, y, w, h } = rect;
      const s = Math.min(imgW / screenW, imgH / screenH);
      const displayW = imgW / s;
      const displayH = imgH / s;
      const offX = (displayW - screenW) / 2;
      const offY = (displayH - screenH) / 2;
      let x0 = (offX + x) * s;
      let y0 = (offY + y) * s;
      let x1 = (offX + x + w) * s;
      let y1 = (offY + y + h) * s;
      const mx = (x1 - x0) * margin;
      const myTop = (y1 - y0) * margin;
      const myBottom = (y1 - y0) * margin;
      x0 = Math.max(0, x0 - mx);
      y0 = Math.max(0, y0 - myTop);
      x1 = Math.min(imgW, x1 + mx);
      y1 = Math.min(imgH, y1 + myBottom);
      norm = {
        x: x0 / imgW,
        y: y0 / imgH,
        w: (x1 - x0) / imgW,
        h: (y1 - y0) / imgH,
      };
    } else {
      norm = OCR_FALLBACK_CROP;
    }
    const left = Math.round(imgW * norm.x);
    const top = Math.round(imgH * norm.y);
    const width = Math.min(Math.round(imgW * norm.w), imgW - left);
    const height = Math.min(Math.round(imgH * norm.h), imgH - top);
    if (width <= 0 || height <= 0) return buffer;
    return await sharp(buffer)
      .extract({ left, top, width, height })
      .grayscale()
      .normalize()
      .toBuffer();
  } catch (error) {
    console.warn('No se pudo recortar la imagen para OCR:', error.message);
    return buffer;
  }
}

module.exports = { cropForOcr, parseCropRect };
