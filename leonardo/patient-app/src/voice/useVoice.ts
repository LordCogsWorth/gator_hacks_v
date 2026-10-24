// Voice prompts with the browser's built-in Web Speech API.
import { useEffect, useState } from 'react';

const MUTE_KEY = 'rehabtrack.muted';
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<(m: boolean) => void>();

export function speak(text: string, { interrupt = true } = {}) {
  if (muted || typeof speechSynthesis === 'undefined') return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}

export function setMuted(m: boolean) {
  muted = m;
  if (m && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // Not saved; still muted for this visit.
  }
  listeners.forEach((l) => l(m));
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(muted);
  useEffect(() => {
    listeners.add(setM);
    return () => void listeners.delete(setM);
  }, []);
  return [m, setMuted];
}

/** Speak `text` once when the screen opens (and again if `text` changes). */
export function useSpeakOnMount(text: string) {
  useEffect(() => {
    speak(text);
  }, [text]);
}
