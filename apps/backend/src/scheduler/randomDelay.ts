export function getRandomDelay(minSeconds: number, maxSeconds: number): number {
  const min = Math.max(1, Math.floor(minSeconds));
  const max = Math.max(min, Math.floor(maxSeconds));
  const seconds = Math.floor(min + Math.random() * (max - min + 1));
  return seconds * 1000;
}
