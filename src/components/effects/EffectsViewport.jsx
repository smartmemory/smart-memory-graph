import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const centered = { zoom: 1, x: 0, y: 0 };

function useViewport(element) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState(centered);
  const zoomAt = useCallback((factor, x = 0, y = 0) => {
    setCamera(current => {
      const zoom = Math.min(32, Math.max(0.25, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return { zoom, x: x + (current.x - x) * ratio, y: y + (current.y - y) * ratio };
    });
  }, []);
  useLayoutEffect(() => {
    const svg = element.current;
    function measure() {
      const { width, height } = svg.getBoundingClientRect();
      if (width && height) setSize({ width, height });
    }
    function wheel(event) {
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1);
      zoomAt(Math.exp(Math.max(-2, Math.min(2, -pixels * .002))),
        event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); svg.removeEventListener('wheel', wheel); };
  }, [element, zoomAt]);
  function pan(x, y) {
    setCamera(current => ({ ...current, x: current.x + x, y: current.y + y }));
  }
  return { size, camera, pan, zoomAt, fit: () => setCamera(centered) };
}

function useDrag(pan) {
  const drag = useRef(null);
  return {
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary || event.target.closest('button')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove(event) {
      if (drag.current?.id !== event.pointerId) return;
      pan(event.clientX - drag.current.x, event.clientY - drag.current.y);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onLostPointerCapture() { drag.current = null; },
  };
}

export default function EffectsViewport({ loading, width, height, children }) {
  const element = useRef(null);
  const { size, camera, pan, zoomAt, fit } = useViewport(element);
  const drag = useDrag(pan);
  const scale = Math.min(size.width / width, size.height / height, 1) * camera.zoom;
  const w = size.width / scale;
  const h = size.height / scale;
  const box = [(width - w) / 2 - camera.x / scale, (height - h) / 2 - camera.y / scale, w, h];
  return <div className="de-scroll" role="region" aria-label="Scrollable decision graph">
    <div className="de-zoom" role="group" aria-label="Graph zoom">
      <button aria-label="Zoom in" onClick={() => zoomAt(1.25)}>+</button>
      <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>−</button>
      <button onClick={fit}>Fit</button>
    </div>
    <svg aria-busy={loading} ref={element} className="de-canvas" role="group" aria-label="Decision graph"
      viewBox={box.join(' ')} {...drag}>{children}</svg>
  </div>;
}
