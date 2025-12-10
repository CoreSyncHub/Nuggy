/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format download count to human-readable format.
 * Example: 1234567 → "1.2M"
 */
export function formatDownloads(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Compare two semantic versions.
 * Returns true if `latest` is newer than `current`.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!current || !latest) {
    return false;
  }

  const parseVersion = (v: string): number[] => {
    const cleanVersion = v.split('-')[0];
    return cleanVersion.split('.').map((n) => Number.parseInt(n, 10) || 0);
  };

  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) {
      return true;
    }
    if (l < c) {
      return false;
    }
  }

  return false;
}
