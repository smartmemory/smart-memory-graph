import { readColorToken } from '../core/themeColors';

// Use the same host tokens and standalone mode defaults as the decision-effects view.
export function rippleStyles(mode, container) {
  const light = mode === 'light';
  const color = (name, fallback) => readColorToken(container, name) || fallback;
  const teal = color('--sm-cat-8', light ? 'hsl(172,80%,27%)' : 'hsl(172,78%,68%)');
  const palette = {
    focus: color('--ring', 'hsl(215,80%,50%)'),
    affected: teal,
    conflict: color('--danger', light ? 'hsl(0,73.7%,41.8%)' : 'hsl(0,90.6%,70.8%)'),
    review: color('--warning', light ? 'hsl(26,90.5%,37.1%)' : 'hsl(47.9,95.8%,53.1%)'),
    replaced: teal,
  };
  const styles = [{ selector: '.ripple-muted', style: { opacity: 0.22 } }];
  for (const [kind, tint] of Object.entries(palette)) {
    const opacity = kind === 'replaced' ? 0.6 : 1;
    styles.push(
      { selector: 'node.ripple-' + kind, style: { opacity, 'border-color': tint, 'border-width': 3,
        'border-style': kind === 'replaced' ? 'dashed' : 'solid', 'border-opacity': 1,
        'underlay-color': tint, 'underlay-padding': 3, 'underlay-opacity': 0.18 } },
      { selector: 'edge.ripple-' + kind, style: { opacity, 'line-color': tint, 'target-arrow-color': tint,
        'source-arrow-color': tint, width: 3, 'underlay-color': tint } },
    );
  }
  styles.push({ selector: '.ripple-flash', style: { 'underlay-opacity': 0.45, 'underlay-padding': 8 } });
  return styles;
}
