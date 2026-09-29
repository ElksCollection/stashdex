// Scannen (stap 5): camera, foto uitknippen en tekst lezen (OCR, gratis in de browser via Tesseract)
import { parseNumbers } from "./scan-match.js";

// Vaste versie, zodat er nooit ongemerkt andere code binnenkomt; de leesbestanden (±5 MB) komen eenmalig van dezelfde CDN
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";

let workerPromise = null, workerReady = false;

// Laadt een script van buiten één keer
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("het leesprogramma kon niet geladen worden")); };
    document.head.append(s);
  });
}

// Is het leesprogramma al geladen? (anders duurt de eerste scan langer)
export const ocrReady = () => workerReady;

// Leesprogramma klaarzetten; mag vaker aangeroepen worden, het wordt maar één keer geladen
export function prepareOcr() {
  return (workerPromise ||= (window.Tesseract ? Promise.resolve() : loadScript(TESSERACT))
    .then(() => window.Tesseract.createWorker("eng"))
    .then(async (worker) => {
      // "Losse tekst": zoekt tekst overal in het stukje, ook tussen plaatjes en symbolen door
      // debug_file: geen logregels van het leesprogramma in de console
      await worker.setParameters({ tessedit_pageseg_mode: "11", debug_file: "/dev/null" });
      workerReady = true;
      return worker;
    })
    .catch((err) => { workerPromise = null; throw err; }));
}

// ---------- Camera ----------

// Achtercamera starten in het video-element; geeft de stream terug (nodig om hem weer uit te zetten)
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Deze browser kan de camera niet gebruiken.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // Hoge resolutie helpt om het kleine kaartnummer te lezen; "ideal" = zo hoog als de camera kan
    video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Knipt het stuk binnen het kader uit het camerabeeld (het beeld vult het vak met object-fit: cover)
export function grabFrame(video, frame) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
  const sx = Math.max(0, (fr.left - vr.left - ox) / scale), sy = Math.max(0, (fr.top - vr.top - oy) / scale);
  const sw = Math.min(vw - sx, fr.width / scale), sh = Math.min(vh - sy, fr.height / scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Gekozen foto (bestand) naar een canvas, rechtop gedraaid en maximaal 3000 px hoog
export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

// Kleine JPEG van de foto, om te tonen tijdens en na het herkennen
export function thumbOf(canvas, height = 420) {
  const k = Math.min(1, height / canvas.height);
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

// ---------- Tekst lezen ----------

// Horizontale strook van de kaart (top/bottom als deel van de hoogte), vergroot tot width, in grijstinten;
// stretch = contrast oprekken (helpt bij donkere of vage foto's)
function strip(src, top, bottom, width, stretch = false) {
  const sy = Math.round(src.height * top), sh = Math.max(1, Math.min(src.height - sy, Math.round(src.height * (bottom - top))));
  const k = width / src.width;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, sy, src.width, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    if (stretch) { if (g < lo) lo = g; if (g > hi) hi = g; }
  }
  const span = hi - lo || 1;
  for (let i = 0; i < d.length; i += 4) {
    const g = stretch ? ((d[i] - lo) * 255) / span : d[i];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function ocr(canvas) {
  const worker = await prepareOcr();
  return (await worker.recognize(canvas)).data.text || "";
}

// Leest de naam (bovenste strook) en het nummer (onderste strook) van een kaart die het hele beeld vult
export async function readCard(card) {
  const name = await ocr(strip(card, 0, 0.18, 1200));
  let number = await ocr(strip(card, 0.9, 1, 2400));
  // Niets gevonden? Nog een keer iets hoger beginnen, met meer contrast
  if (!parseNumbers(number).length) number += "\n" + await ocr(strip(card, 0.86, 1, 2400, true));
  return { name, number };
}

// Leest alle tekst in het hele beeld (voor een gekozen foto waar de kaart kleiner in staat)
export function readWhole(canvas) {
  return ocr(strip(canvas, 0, 1, Math.min(2400, Math.max(1200, canvas.width)), true));
}
