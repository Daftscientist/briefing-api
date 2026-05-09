import { WORDS } from './words.js';

export function generateToken(wordCount: number = 7): string {
  const selected: string[] = [];
  const available = [...WORDS];
  
  for (let i = 0; i < wordCount; i++) {
    const idx = Math.floor(Math.random() * available.length);
    selected.push(available[idx]);
    available.splice(idx, 1); // No duplicates
  }
  
  return selected.join('-');
}
