/**
 * Light/dark helpers shared by the style builder, the drip feed and the exporters.
 *
 * Cytoscape styles are JS values, not CSS, so they do not follow the host's `.light` / `.dark`
 * class by themselves (UI-LIGHT-MODE-1 design.md section 6). The host passes the resolved mode
 * (`useColorMode()` from the design-system kit) and these helpers turn it into canvas colours.
 * Token values come from the host's CSS variables, never from a copy of the palette here.
 */

/** Anything but an explicit 'light' is dark, so existing consumers are unchanged until they opt in. */
export function resolveMode(mode) {
  return mode === 'light' ? 'light' : 'dark';
}

/**
 * Read a design-system colour token (`--ring`, `--background`, ...) as a CSS colour string
 * Cytoscape can parse. The kit stores tokens as bare `H S% L%` triplets (for `hsl(var(--x))`),
 * which Cytoscape does not understand, so a triplet is rewritten to `hsl(H, S%, L%)`.
 * Returns `null` when there is no element, no `getComputedStyle`, or the variable is unset, so
 * the caller falls back to its own default (logged by the caller when that matters).
 */
export function readColorToken(el, name) {
  if (!el || typeof getComputedStyle !== 'function') return null;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return null;
  const triplet = raw.match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/);
  if (triplet) return `hsl(${triplet[1]}, ${triplet[2]}%, ${triplet[3]}%)`;
  return raw;
}

/** Canvas background for PNG/SVG export: the page background of the mode. */
export const EXPORT_BACKGROUND = { dark: '#0f172a', light: '#ffffff' };

/** cy.scratch key the hook stores the applied mode under, for code that only holds a `cy`. */
export const MODE_SCRATCH_KEY = '_smMode';

/** The mode last applied to this cy (dark when the hook never set one). */
export function modeOf(cy) {
  return resolveMode(cy?.scratch?.(MODE_SCRATCH_KEY));
}

/** Transient edge-pulse orb colour: sky-200 glows on dark, but is invisible on a white canvas. */
export const PULSE_COLOR = { dark: '#a5f3fc', light: '#0891b2' };

/**
 * `#rrggbb` / `#rgb` to the bare `H S% L%` triplet the design-system tokens carry. Other input: null.
 * Two decimals, not whole numbers: whole-number HSL rounds a channel by up to 1/255, so a fallback
 * would not render as the original hex. At two decimals every colour rounds back to its own bytes
 * (the "round-trips to the same hex" test row).
 */
export function hexToTriplet(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const f = (v) => String(Number(v.toFixed(2)));
  if (mx === mn) return `0 0% ${f(l * 100)}%`;
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let hue;
  if (mx === r) hue = ((g - b) / d) % 6;
  else if (mx === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return `${f(((hue * 60) + 360) % 360)} ${f(s * 100)}% ${f(l * 100)}%`;
}

/**
 * A design-system token as an inline-style colour: `hsl(var(--name, <fallback>))`. A host that
 * loads the kit tokens follows its light/dark class; a host without them gets `fallbackHex`, which
 * is the colour the component always had (dark), so nothing changes until the tokens are present.
 */
export function tokenColor(name, fallbackHex) {
  const fb = hexToTriplet(fallbackHex);
  if (!fb) throw new Error(`tokenColor(${name}): fallback must be #rgb or #rrggbb, got ${fallbackHex}`);
  return `hsl(var(--${name}, ${fb}))`;
}
