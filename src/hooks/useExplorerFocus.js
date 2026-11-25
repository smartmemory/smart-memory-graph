import { useCallback, useEffect, useRef, useState } from 'react';
import { LAYOUT_OPTIONS } from '../core/constants';
import { normalizeAPIResponse } from '../core/normalize';
import { graphNodeToCyElement } from '../internal/cytoscapeConvert';

export function useExplorerFocus({ adapter, daemon, snapshot, asOfTime, loading, urlState, cytoscape, filters, interaction, historicalRef, restoredView }) {
  const [focusStatus, setFocusStatus] = useState(null);
  const focusRequest = useRef(0);
  const { selectNode, handleLayoutChange, closeDetailPanel, timeTravelError } = interaction;
  const currentUrlState = useRef(urlState);
  currentUrlState.current = urlState;
  const focusNode = useCallback(async (id, { decision = false, center = true } = {}) => {
    const cy = cytoscape.cy.current;
    if (!cy) return;
    const request = ++focusRequest.current;
    setFocusStatus(null);
    let node = cy.$id(id);
    if (!node.isNode()) {
      const read = decision && !daemon ? adapter?.getDecision || adapter?.getMemory : adapter?.getMemory;
      if (!snapshot && read) {
        setFocusStatus({ message: 'Loading the selected node…' });
        try {
          const response = await read(id);
          if (request !== focusRequest.current || historicalRef.current) return;
          const item = response?.decision ?? response?.item ?? response;
          const { nodes: found } = normalizeAPIResponse({ nodes: item ? [{
            ...item, item_id: item.item_id ?? item.decision_id ?? item.id,
            memory_type: decision ? 'decision' : item.memory_type,
            metadata: decision ? { ...item, ...item.metadata } : item.metadata,
          }] : [] });
          if (found[0]?.id === id) {
            cytoscape.addElements([graphNodeToCyElement(found[0])], { relayout: false });
            filters.registerStreamedElements(found);
            node = cy.$id(id);
          }
        } catch {
          if (request === focusRequest.current) setFocusStatus({ error: true, message: 'Could not load the selected node.' });
          return;
        }
      }
    }
    if (!node.isNode()) {
      setFocusStatus({ error: true, message: 'The selected node is unavailable in this graph.' });
      return;
    }
    cy.elements(':selected').unselect();
    cytoscape.clearHighlights();
    selectNode(node.data());
    if (center) cy.center(node);
    setFocusStatus(!node.visible() ? { message: 'The selected node is hidden by graph filters.' } : null);
  }, [adapter, daemon, snapshot, cytoscape.cy, cytoscape.addElements, cytoscape.clearHighlights, historicalRef, filters.registerStreamedElements, selectNode]);

  useEffect(() => () => { focusRequest.current++; }, [urlState, snapshot, adapter]);

  useEffect(() => {
    const cy = cytoscape.cy.current;
    if (!cytoscape.ready || !cy || restoredView.current === urlState) return;
    if (!urlState.focusOnly && urlState.asOfTime && asOfTime !== urlState.asOfTime && !timeTravelError) return;
    if (!urlState.focusOnly && !urlState.asOfTime && snapshot) return;
    if (loading && !snapshot) return;
    const previous = restoredView.current;
    restoredView.current = urlState;
    if (!previous && Object.keys(urlState).length === 0) return;

    const { selected, relation, zoom, pan, filters: types } = urlState;
    const layout = LAYOUT_OPTIONS.find(({ id }) => id === urlState.layout)?.id || 'cose-bilkent';
    const focusSelection = () => {
      if (relation) {
        const byId = cy.$id(relation);
        const edge = byId.isEdge() ? byId : cy.edges().filter((candidate) =>
          `${candidate.source().id()}->${candidate.target().id()}:${candidate.data('type')}` === relation
        ).first();
        cy.elements(':selected').unselect();
        closeDetailPanel();
        cytoscape.clearHighlights();
        if (!edge.length || !edge.visible()) {
          setFocusStatus({ error: true, message: 'The selected relation is unavailable in this graph view.' });
          return;
        }
        edge.select();
        cytoscape.highlightElements([edge.source().id(), edge.target().id()], [edge.id()]);
        if (!pan) cy.fit(edge.connectedNodes(), 50);
        setFocusStatus(null);
      } else if (selected) {
        void focusNode(selected, { center: !pan });
      } else {
        setFocusStatus(null);
        cy.elements().unselect();
        cytoscape.clearHighlights();
        closeDetailPanel();
      }
    };
    if (urlState.focusOnly) {
      focusSelection();
      return;
    }
    filters.restoreTypes(types);
    const restoreViewport = () => {
      if (currentUrlState.current !== urlState) return;
      if (Number.isFinite(zoom) && zoom > 0) cy.zoom(zoom);
      if (pan) cy.pan(pan);
      focusSelection();
    };
    if (cy.nodes().length) {
      handleLayoutChange(layout, { animate: false, fit: !zoom && !pan && !selected && !relation, onComplete: restoreViewport });
    } else {
      handleLayoutChange(layout);
      restoreViewport();
    }
  }, [asOfTime, snapshot, loading, urlState, cytoscape, focusNode, filters, restoredView, timeTravelError, handleLayoutChange, closeDetailPanel]);

  const handleDecisionSelect = useCallback((id) => focusNode(id, { decision: true }), [focusNode]);
  return { focusStatus, handleDecisionSelect };
}
