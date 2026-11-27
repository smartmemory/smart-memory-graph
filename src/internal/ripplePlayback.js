import { planRipple } from '../core/rippleTiming';

const classes = 'ripple-muted ripple-focus ripple-affected ripple-review ripple-conflict ripple-replaced ripple-flash';
const FLASH_MS = 160;

// Own only ripple classes and one decorative ring. Never move, add, or remove graph elements.
export function playRipple(cy, snapshot, onProjection) {
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const started = performance.now();
  let cancelFrame, refreshFrame;
  let hidden = new Map();

  function project() {
    refreshFrame = undefined;
    cancelFrame?.();
    if (cy.destroyed()) return;
    const nodes = cy.nodes();
    hidden = new Map(nodes.map(n => [n.id(), n.hasClass('dimmed')]));
    const ids = nodes.filter(n => n.visible()).map(n => n.id());
    const edges = cy.edges(':visible').map(e => e.data());
    const plan = planRipple(snapshot, ids, edges, motion?.matches);
    onProjection({ offScreen: plan.offScreen, empty: plan.affected === 0 });
    cy.batch(() => {
      cy.elements().removeClass(classes);
      if (plan.affected) cy.elements().addClass('ripple-muted');
    });
    if (plan.affected) cancelFrame = animate(cy, snapshot.focus, plan.events, started, motion?.matches);
  }

  function refresh(event) {
    const el = event?.target;
    if (event?.type === 'style' && (!el.isNode?.() || hidden.get(el.id()) === el.hasClass('dimmed'))) return;
    if (refreshFrame == null) refreshFrame = requestAnimationFrame(project);
  }

  project();
  cy.on('add remove style', refresh);
  motion?.addEventListener('change', refresh);
  return () => {
    cy.off('add remove style', refresh);
    motion?.removeEventListener('change', refresh);
    cancelAnimationFrame(refreshFrame);
    cancelFrame?.();
    if (!cy.destroyed()) cy.elements().removeClass(classes);
  };
}

// Apply arrivals in frame-sized batches so long or sparse chains need only one scheduled frame.
function animate(cy, focus, arrivals, started, reduced) {
  const end = arrivals.at(-1)?.at || 0;
  const ring = reduced ? null : sourceRing(cy, focus, arrivals);
  let next = 0, settled = 0, frame;
  function draw() {
    const elapsed = performance.now() - started;
    cy.batch(() => {
      while (next < arrivals.length && arrivals[next].at <= elapsed) {
        const { id, kind } = arrivals[next++];
        const el = cy.getElementById(id).removeClass('ripple-muted').addClass('ripple-' + kind);
        if (!reduced) el.addClass('ripple-flash');
      }
      while (!reduced && settled < next && arrivals[settled].at + FLASH_MS <= elapsed) {
        cy.getElementById(arrivals[settled++].id).removeClass('ripple-flash');
      }
    });
    if (!reduced && elapsed < end + FLASH_MS) {
      ring?.draw(elapsed / (end + FLASH_MS));
      frame = requestAnimationFrame(draw);
    } else ring?.remove();
  }
  draw();
  return () => { cancelAnimationFrame(frame); ring?.remove(); };
}

// Anchor the ring to the decision as the viewer pans or zooms.
function sourceRing(cy, focus, arrivals) {
  const origin = cy.getElementById(focus);
  if (!origin.length || !origin.visible()) return;
  const ring = document.createElement('div');
  ring.className = 'sm-ripple-ring';
  ring.setAttribute('aria-hidden', 'true');
  cy.container().appendChild(ring);
  const start = origin.position();
  let reach = 40;
  for (const { element, id } of arrivals) {
    if (element !== 'node') continue;
    const pos = cy.getElementById(id).position();
    reach = Math.max(reach, Math.hypot(pos.x - start.x, pos.y - start.y));
  }
  return {
    draw(progress) {
      const { x, y } = origin.renderedPosition();
      const radius = (origin.width() / 2 + progress * reach) * cy.zoom();
      ring.style.cssText = `left:${x}px;top:${y}px;width:${2 * radius}px;height:${2 * radius}px;opacity:${0.82 * (1 - progress)}`;
    },
    remove: () => ring.remove(),
  };
}
