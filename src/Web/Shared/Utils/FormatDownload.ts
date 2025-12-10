export function formatDownloads(n: number | undefined | null): string {
  if (n === undefined || n === null) return '';
  if (n < 1000) return String(n);
  const units = ['k', 'M', 'G', 'T'];
  let value = n;
  let unitIndex = -1;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value = value / 1000;
    unitIndex++;
  }
  if (unitIndex === -1) return String(Math.round(value));
  // Keep one decimal if necessary
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded}${units[unitIndex]}`;
}
