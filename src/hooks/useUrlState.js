import { useState, useCallback, useEffect, useRef } from 'react';

// Encode graph view state into the URL hash for shareable links.
// Format: #layout=X&selected=Y&filters=a,b,c&zoom=Z&pan=x,y

function encodeState(state) {
  const params = new URLSearchParams();
  if (state.layout) params.set('layout', state.layout);
  if (state.relation) params.set('relation', state.relation);
  if (state.selected) params.set('selected', state.selected);
  if (Array.isArray(state.filters)) params.set('filters', state.filters.join(','));
  if (state.zoom != null && typeof state.zoom === 'number' && !isNaN(state.zoom)) {
    params.set('zoom', state.zoom.toFixed(2));
  }
  if (state.pan) params.set('pan', `${Math.round(state.pan.x)},${Math.round(state.pan.y)}`);
  if (state.asOfTime) params.set('asof', state.asOfTime);
  return params.toString();
}

function decodeState(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state = {};
  if (params.has('layout')) state.layout = params.get('layout');
  if (params.has('relation')) state.relation = params.get('relation');
  if (params.has('selected')) state.selected = params.get('selected');
  if (params.has('filters')) state.filters = params.get('filters').split(',').filter(Boolean);
  if (params.has('zoom')) state.zoom = parseFloat(params.get('zoom'));
  if (params.has('pan')) {
    const [x, y] = params.get('pan').split(',').map(Number);
    if (!isNaN(x) && !isNaN(y)) state.pan = { x, y };
  }
  if (params.has('asof')) state.asOfTime = params.get('asof');
  return state;
}

export function useUrlState(focusRequest) {
  const [initialState] = useState(() => decodeState(window.location.hash));
  const lastHash = useRef(window.location.hash);

  const [urlState, setUrlState] = useState(initialState);

  useEffect(() => {
    if (!focusRequest) return;
    window.history.replaceState(null, '', focusRequest.hash);
    lastHash.current = window.location.hash;
    setUrlState({ ...decodeState(lastHash.current), focusOnly: true });
  }, [focusRequest]);

  useEffect(() => {
    const onPop = () => {
      if (lastHash.current === window.location.hash) return;
      const newState = decodeState(window.location.hash);
      setUrlState(newState);
      lastHash.current = window.location.hash;
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const saveToUrl = useCallback((state) => {
    const hash = '#' + encodeState(state);
    if (hash !== lastHash.current) {
      window.history.pushState(null, '', hash);
      lastHash.current = hash;
    }
  }, []);

  const getShareableUrl = useCallback((state) => {
    const hash = '#' + encodeState(state);
    return `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
  }, []);

  const clearHistoricalUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has('asof')) return;
    params.delete('asof');
    const hash = params.size ? `#${params}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    lastHash.current = hash;
  }, []);

  return { urlState, saveToUrl, getShareableUrl, clearHistoricalUrl };
}
