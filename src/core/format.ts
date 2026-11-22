const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/**
 * Compact idle-game number formatting: 999, 1.23K, 45.6M, 7.89T, then aa, ab, ac…
 * Plain doubles cover values up to ~1e308, which is far beyond what early milestones reach;
 * all growth formulas live in balance.ts so a big-number type can be swapped in later.
 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  const scaled = n / Math.pow(1000, tier);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return trimTo(scaled, digits) + suffix(tier);
}

function trimTo(v: number, digits: number): string {
  // Floor instead of round so "999.99K" never displays as "1000K".
  const p = Math.pow(10, digits);
  return (Math.floor(v * p) / p).toFixed(digits);
}

function suffix(tier: number): string {
  if (tier < SUFFIXES.length) return SUFFIXES[tier];
  const i = tier - SUFFIXES.length;
  const a = String.fromCharCode(97 + Math.floor(i / 26) % 26);
  const b = String.fromCharCode(97 + (i % 26));
  return a + b;
}

export function pct(n: number): string {
  return (n * 100).toFixed(n < 0.1 ? 1 : 0) + '%';
}
