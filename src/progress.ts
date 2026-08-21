/** Simple one-line progress for long fetches (no full URLs). */
export function progress(msg: string): void {
  console.log(`  … ${msg}`);
}

export function progressPhase(title: string): void {
  console.log(`\n→ ${title}`);
}
