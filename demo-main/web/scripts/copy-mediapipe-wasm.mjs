// postinstall: copy the MediaPipe WASM runtime into public/mediapipe/wasm so the camera tracker works
// fully offline (mediapipeTracker.ts tries /mediapipe/wasm first, then jsDelivr). public/mediapipe/ is
// generated and git-ignored. Never fails the install: a missing package only means the CDN fallback is used.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

try {
  if (!existsSync(src)) {
    console.warn(`[copy-mediapipe-wasm] ${src} not found; the camera will load WASM from the CDN.`);
  } else {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    const files = readdirSync(dest);
    console.log(`[copy-mediapipe-wasm] copied ${files.length} files to public/mediapipe/wasm`);
  }
} catch (e) {
  console.warn('[copy-mediapipe-wasm] copy failed; the camera will load WASM from the CDN.', e);
}
