import { useState, useCallback, useRef } from 'react';
import { buildAdjacency, bfsExpand } from '../core/multiHopBfs';
import { getNodeColor } from '../core/graphColors';

const HOP_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e'];
const HOP_DELAY_MS = 700;
const FADE_DURATION_MS = 350;

/**
 * Orchestrates a hop-by-hop reveal animation on the Cytoscape canvas.
 *
 * Dims all nodes, then progressively reveals nodes grouped by BFS hop from
 * a start node. Each hop fades in with a distinct color and a configurable
 * delay between hops. Uses the already-loaded graph data — no API calls.
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value (cy ref + helpers)
 * @param {Object} options.graphData - useGraphData return value ({ nodes, edges })
 */
export function useMultiHopReplay({ cytoscape, graphData }) {
  const [replayState, setReplayState] = useState('idle');
  const [activeHop, setActiveHop] = useState(-1);
  const [hopStats, setHopStats] = useState(null);
  const cancelRef = useRef(false);

  const startReplay = useCallback((startNodeId, maxHops = 3) => {
    const cy = cytoscape?.cy?.current;
    if (!cy || !startNodeId) return;
    if (!graphData?.edges?.length) return;

    cancelRef.current = false;
    setReplayState('playing');
    setActiveHop(0);

    const adjacency = buildAdjacency(graphData.edges);
    const result = bfsExpand({
      startId: startNodeId,
      adjacency,
      maxHops,
      maxNodesPerHop: 50,
    });

    setHopStats(result.hops);

    const hopNodeSets = [];
    const visited = new Set([startNodeId]);

    let frontier = [startNodeId];
    for (let hop = 0; hop < result.hops.length; hop++) {
      const nextFrontier = [];
      const hopNodes = [];
      for (const fid of frontier) {
        const neighbours = adjacency.get(fid) || [];
        for (const { id } of neighbours) {
          if (visited.has(id)) continue;
          if (result.nodes.has(id)) {
            visited.add(id);
            hopNodes.push(id);
            nextFrontier.push(id);
          }
        }
      }
      hopNodeSets.push(hopNodes);
      frontier = nextFrontier;
    }

    // Dim everything first
    cy.elements().animate(
      { style: { opacity: 0.08 } },
      { duration: FADE_DURATION_MS },
    );

    // Reveal start node immediately
    const startEl = cy.getElementById(startNodeId);
    if (startEl.length) {
      startEl.animate(
        { style: { opacity: 1, 'border-width': 6, 'border-color': HOP_COLORS[0] } },
        { duration: FADE_DURATION_MS },
      );
    }

    // Reveal each hop with a delay
    hopNodeSets.forEach((nodeIds, hopIdx) => {
      setTimeout(() => {
        if (cancelRef.current) return;
        setActiveHop(hopIdx + 1);

        const color = HOP_COLORS[(hopIdx + 1) % HOP_COLORS.length];
        for (const nid of nodeIds) {
          const node = cy.getElementById(nid);
          if (node.length) {
            node.animate(
              { style: { opacity: 1, 'border-width': 4, 'border-color': color } },
              { duration: FADE_DURATION_MS },
            );
          }

          // Also reveal edges connecting to previously-revealed nodes
          const connEdges = node.connectedEdges();
          connEdges.forEach(edge => {
            const src = edge.source().id();
            const tgt = edge.target().id();
            if (visited.has(src) && visited.has(tgt)) {
              edge.animate(
                { style: { opacity: 0.7, 'line-color': color, width: 2 } },
                { duration: FADE_DURATION_MS },
              );
            }
          });
        }

        if (hopIdx === hopNodeSets.length - 1) {
          setTimeout(() => {
            if (!cancelRef.current) setReplayState('done');
          }, FADE_DURATION_MS + 200);
        }
      }, (hopIdx + 1) * HOP_DELAY_MS);
    });
  }, [cytoscape, graphData]);

  const stopReplay = useCallback(() => {
    cancelRef.current = true;
    setReplayState('idle');
    setActiveHop(-1);
    setHopStats(null);

    const cy = cytoscape?.cy?.current;
    if (cy) {
      cy.elements().animate(
        { style: { opacity: 1, 'border-width': 2, 'border-color': null } },
        { duration: FADE_DURATION_MS },
      );
      cy.elements().removeStyle('border-color line-color');
    }
  }, [cytoscape]);

  return {
    replayState,
    activeHop,
    hopStats,
    startReplay,
    stopReplay,
    HOP_COLORS,
  };
}
