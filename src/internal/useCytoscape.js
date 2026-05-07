import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import cytoscape from 'cytoscape';
import cola from 'cytoscape-cola';
import coseBilkent from 'cytoscape-cose-bilkent';
import dagre from 'cytoscape-dagre';
import { getCytoscapeStyles } from './cytoscapeStyles';
import { ANNOTATION_PRECEDENCE, CHANNEL_LOCKED_KINDS } from '../core/graphColors';

// Register layout extensions once
let registered = false;
if (!registered) {
  cytoscape.use(cola);
  cytoscape.use(coseBilkent);
  cytoscape.use(dagre);
  registered = true;
}

/**
 * Layout config for the streaming/unfurling phase.
 * Runs cola force simulation continuously so newly arrived nodes drift
 * to their settled position while the stream is active.
 * Called directly via cy.layout(STREAMING_LAYOUT).run() — NOT via runLayout(),
 * which uses a layoutDefaults map and firstLayoutRef that would clobber this config.
 */
export const STREAMING_LAYOUT = {
  name: 'cola',
  animate: true,
  animationDuration: 150,
  refresh: 2,
  maxSimulationTime: 1200,
  ungrabifyWhileSimulating: false,
  fit: false,
  padding: 20,
  nodeSpacing: () => 12,
  edgeLength: 110,
  randomize: false,
  avoidOverlap: true,
};

/**
 * Get the elements that should define the fit bounds: visible AND not dimmed.
 * Falls back to all visible if everything is dimmed (avoids fitting to empty set).
 */
export function getFitElements(cy) {
  const active = cy.elements(':visible').not('.dimmed');
  return active.length > 0 ? active : cy.elements(':visible');
}

/** Padding proportional to the viewport's smaller dimension (3%, clamped 12–48px). */
export function getFitPadding(cy) {
  return Math.round(Math.max(12, Math.min(48, Math.min(cy.width(), cy.height()) * 0.03)));
}

export function useCytoscape(containerRef, options = {}) {
  const { theme = null } = options;
  const cyRef = useRef(null);
  const [containerReady, setContainerReady] = useState(false);
  const [cyReady, setCyReady] = useState(false);

  // Autofit: when enabled, cy.fit() runs on every container resize
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  useEffect(() => { autoFitRef.current = autoFit; }, [autoFit]);

  const [selectedNodeIds, setSelectedNodeIds] = useState(new Set());
  const [selectionMode, setSelectionModeState] = useState(false);
  const selectionModeRef = useRef(false);

  // Stable ref for event callbacks
  const onNodeClickRef = useRef(null);
  const onNodeDblClickRef = useRef(null);
  const onNodeHoverRef = useRef(null);
  const onNodeHoverOutRef = useRef(null);
  const onBgClickRef = useRef(null);

  // Refs for dimming state — declared early so setElements/mergeElements/addElements can restore.
  const lastFilterArgsRef = useRef(null);
  const isolationRef = useRef(false);
  const isolatedIdsRef = useRef(null);

  const setContainerRef = useCallback((node) => {
    containerRef.current = node;
    setContainerReady(!!node);
  }, [containerRef]);

  // Initialize Cytoscape when container is available
  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) return;

    const container = containerRef.current;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const cy = cytoscape({
      container,
      style: getCytoscapeStyles(theme),
      elements: [],
      layout: { name: 'preset' },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autounselectify: false,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (!node.isNode() || node === cy) return;
      // In selection mode, tap toggles selection only — don't open detail panel.
      if (selectionModeRef.current) return;
      if (onNodeClickRef.current) onNodeClickRef.current(node.data());
    });
    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target;
      if (node !== cy && node.isNode() && onNodeDblClickRef.current) {
        onNodeDblClickRef.current(node.data());
      }
    });
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      if (node === cy || !node.isNode()) return;

      cy.batch(() => {
        const neighborhood = node.closedNeighborhood();
        // Dim visible non-neighbors (skip already-hidden .dimmed elements)
        cy.elements(':visible').not(neighborhood).not('.dimmed').addClass('hover-dimmed');
        // Reveal labels on this node's connected edges
        node.connectedEdges(':visible').addClass('hover-edge-visible');
        node.addClass('hovered');
      });

      if (onNodeHoverRef.current) {
        const pos = evt.renderedPosition || evt.position;
        onNodeHoverRef.current(node.data(), pos);
      }
    });
    cy.on('mouseout', 'node', () => {
      cy.batch(() => {
        cy.elements().removeClass('hover-dimmed hover-edge-visible hovered');
      });
      onNodeHoverOutRef.current?.();
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().unselect();
        cy.elements().removeClass('neighbor');
        onBgClickRef.current?.();
      }
    });

    // Track selected nodes for multi-select delete
    const syncSelection = () => {
      setSelectedNodeIds(new Set(cy.nodes(':selected').map((n) => n.id())));
    };
    cy.on('select unselect', 'node', syncSelection);

    let prevWidth = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const newWidth = entry?.contentRect?.width || 0;
      cy.resize();
      if (cy.nodes().length > 0) {
        if (prevWidth === 0 && newWidth > 0) {
          // Container went from hidden (0px) to visible — layout was computed
          // at zero dimensions, so positions are degenerate. Re-run layout
          // instantly (no entrance animation — that's for first load only).
          const layout = cy.layout({
            name: 'cose-bilkent', quality: 'default', animate: false,
            randomize: true, nodeDimensionsIncludeLabels: true,
            fit: true, padding: 30, idealEdgeLength: 110,
            nodeRepulsion: 10000, edgeElasticity: 0.12,
          });
          layout.run();
        } else if (autoFitRef.current) {
          cy.fit(getFitElements(cy), getFitPadding(cy));
        }
      }
      prevWidth = newWidth;
    });
    resizeObserver.observe(container);

    cyRef.current = cy;
    setCyReady(true);

    return () => {
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
      setCyReady(false);
    };
  }, [containerReady, containerRef]);

  // Restore filter/isolation dimming after element replacement or addition.
  // Reads from refs so it works regardless of declaration order.
  function restoreDimmingState(cy) {
    if (!cy) return;
    if (isolationRef.current && isolatedIdsRef.current) {
      const ids = isolatedIdsRef.current;
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          if (!ids.has(n.id())) n.addClass('dimmed');
        });
        cy.edges().forEach((e) => {
          if (!ids.has(e.source().id()) || !ids.has(e.target().id())) {
            e.addClass('dimmed');
          }
        });
      });
    } else if (lastFilterArgsRef.current) {
      const { visibleNodeIds, visibleEdgeTypes, cascade } = lastFilterArgsRef.current;
      // Inline the filter logic — can't call applyFilter here since it may not be defined yet.
      cy.batch(() => {
        const nodesWithVisibleEdge = new Set();
        cy.edges().forEach((edge) => {
          const srcOk = visibleNodeIds.has(edge.source().id());
          const tgtOk = visibleNodeIds.has(edge.target().id());
          const edgeOk = !visibleEdgeTypes || visibleEdgeTypes.has(edge.data('type'));
          if (srcOk && tgtOk && edgeOk) {
            edge.removeClass('dimmed');
            nodesWithVisibleEdge.add(edge.source().id());
            nodesWithVisibleEdge.add(edge.target().id());
          } else {
            edge.addClass('dimmed');
          }
        });
        cy.nodes().forEach((node) => {
          if (!visibleNodeIds.has(node.id())) {
            node.addClass('dimmed');
          } else if (!cascade || nodesWithVisibleEdge.has(node.id())) {
            node.removeClass('dimmed');
          } else {
            node.addClass('dimmed');
          }
        });
      });
    }
  }

  const setElements = useCallback((elements) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      restoreDimmingState(cy);
    });
  }, []);

  /**
   * Diff-merge elements into the graph, preserving positions of existing nodes.
   * Returns { isInitial: true } when the graph was empty before (full layout needed).
   * On refresh (graph already populated), positions are restored and no layout is run.
   */
  const mergeElements = useCallback((elements) => {
    const cy = cyRef.current;
    if (!cy) return { isInitial: true };

    const existingIds = new Set(cy.nodes().map((n) => n.id()));
    const isInitial = existingIds.size === 0;

    // Snapshot positions of every existing node before replace.
    const savedPositions = {};
    if (!isInitial) {
      cy.nodes().forEach((n) => {
        savedPositions[n.id()] = { ...n.position() };
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      // Restore saved positions for nodes that survived the refresh.
      if (!isInitial) {
        cy.nodes().forEach((n) => {
          const pos = savedPositions[n.id()];
          if (pos) n.position(pos);
        });
      }
      restoreDimmingState(cy);
    });

    return { isInitial };
  }, []);

  const firstLayoutRef = useRef(true);
  const runLayoutRef = useRef(null);

  const runLayout = useCallback((layoutName = 'cose-bilkent', options = {}) => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    const isFirstLayout = firstLayoutRef.current;
    const shouldAnimate = !isFirstLayout;
    firstLayoutRef.current = false;

    const layoutDefaults = {
      'cose-bilkent': {
        name: 'cose-bilkent',
        quality: 'default',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        nodeDimensionsIncludeLabels: true,
        fit: true,
        padding: 30,
        idealEdgeLength: 110,
        edgeElasticity: 0.12,
        nodeRepulsion: 10000,
        nestingFactor: 0.05,
        gravity: 1.6,
        gravityRange: 2.4,
        gravityCompound: 1.0,
        gravityRangeCompound: 2.0,
        numIter: 1200,
        tile: false,
        randomize: true,
      },
      dagre: {
        name: 'dagre',
        rankDir: 'TB',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        fit: true,
        padding: 30,
        nodeSep: 50,
        rankSep: 80,
      },
      circle: {
        name: 'circle',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        fit: true,
        padding: 30,
      },
      concentric: {
        name: 'concentric',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        fit: true,
        padding: 30,
        concentric: (node) => node.degree(),
        levelWidth: () => 2,
      },
      grid: {
        name: 'grid',
        animate: shouldAnimate,
        animationDuration: 600,
        animationEasing: 'ease-in-out-sine',
        fit: true,
        padding: 30,
        condense: true,
      },
    };

    const config = {
      ...(layoutDefaults[layoutName] || { name: layoutName }),
      ...options,
    };

    if (isFirstLayout) {
      config.fit = true;
      if (Object.prototype.hasOwnProperty.call(config, 'randomize')) {
        config.randomize = true;
      }
    }

    const layout = cy.layout(config);
    layout.one('layoutstop', () => {
      if (config.fit === false) return;
      cy.resize();
      cy.fit(getFitElements(cy), getFitPadding(cy));
    });

    if (isFirstLayout) {
      requestAnimationFrame(() => {
        cy.resize();
        layout.run();
      });
      return;
    }

    layout.run();
  }, []);
  runLayoutRef.current = runLayout;

  const zoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);

  const zoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);

  const fitToScreen = useCallback(() => {
    const cy = cyRef.current;
    if (cy) cy.fit(getFitElements(cy), getFitPadding(cy));
  }, []);

  const applyFilter = useCallback((visibleNodeIds, visibleEdgeTypes, cascade = true) => {
    const cy = cyRef.current;
    if (!cy) return;
    lastFilterArgsRef.current = { visibleNodeIds, visibleEdgeTypes, cascade };
    cy.batch(() => {
      const nodesWithVisibleEdge = new Set();
      const targetsOfFilteredEdges = new Set();
      cy.edges().forEach((edge) => {
        const srcTypeOk = visibleNodeIds.has(edge.source().id());
        const tgtTypeOk = visibleNodeIds.has(edge.target().id());
        const edgeTypeOk = !visibleEdgeTypes || visibleEdgeTypes.has(edge.data('type'));
        if (srcTypeOk && tgtTypeOk && edgeTypeOk) {
          edge.removeClass('dimmed');
          nodesWithVisibleEdge.add(edge.source().id());
          nodesWithVisibleEdge.add(edge.target().id());
        } else {
          edge.addClass('dimmed');
          if (srcTypeOk && tgtTypeOk && !edgeTypeOk) {
            targetsOfFilteredEdges.add(edge.target().id());
          }
        }
      });

      cy.nodes().forEach((node) => {
        if (!visibleNodeIds.has(node.id())) {
          node.addClass('dimmed');
          return;
        }
        if (!cascade) {
          node.removeClass('dimmed');
          return;
        }
        const hasVisibleEdge = nodesWithVisibleEdge.has(node.id());
        if (!hasVisibleEdge) {
          node.addClass('dimmed');
        } else {
          node.removeClass('dimmed');
        }
      });
    });
  }, []);

  // Re-apply the last known filters (used after clearing isolation/highlights).
  const reapplyFilters = useCallback(() => {
    const args = lastFilterArgsRef.current;
    if (args) {
      applyFilter(args.visibleNodeIds, args.visibleEdgeTypes, args.cascade);
    }
  }, [applyFilter]);

  const applyAnnotations = useCallback((annotations) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // 1. Clear all previous annotation classes
      cy.elements().forEach((ele) => {
        const classes = ele.classes();
        classes.forEach((cls) => {
          if (cls.startsWith('anno-')) ele.removeClass(cls);
        });
      });

      if (!annotations || !annotations.activeKinds?.length) return;

      // 2. Resolve precedence per element.
      // Channel assignment is computed per-element based on which kinds are actually
      // present on that element, not globally. A node with only 'confidence' gets
      // fill for confidence, even if diff/ontology_status are globally active.
      const precedence = annotations.precedence || ANNOTATION_PRECEDENCE;
      const availableChannels = ['fill', 'border', 'opacity'];
      const lockedKinds = CHANNEL_LOCKED_KINDS || {};

      const resolveChannels = (annoList) => {
        const assignment = {};
        // Channel-locked kinds first
        for (const anno of annoList) {
          if (lockedKinds[anno.kind]) {
            assignment[anno.kind] = lockedKinds[anno.kind];
          }
        }
        // Competing kinds by precedence (only kinds present on this element)
        const presentKinds = new Set(annoList.map((a) => a.kind));
        let chIdx = 0;
        for (const kind of precedence) {
          if (!presentKinds.has(kind)) continue;
          if (assignment[kind]) continue;
          if (chIdx < availableChannels.length) {
            assignment[kind] = availableChannels[chIdx++];
          }
        }
        return assignment;
      };

      // 3. Apply channel-scoped classes
      const applyToElement = (eleId, annoList) => {
        const ele = cy.getElementById(eleId);
        if (!ele.length) return;
        const assignment = resolveChannels(annoList);
        for (const anno of annoList) {
          const channel = assignment[anno.kind];
          if (!channel) continue;
          ele.addClass(`anno-${channel}-${anno.kind}-${anno.value}`);
        }
      };

      if (annotations.nodes) {
        for (const [nodeId, annoList] of Object.entries(annotations.nodes)) {
          applyToElement(nodeId, annoList);
        }
      }
      if (annotations.edges) {
        for (const [edgeId, annoList] of Object.entries(annotations.edges)) {
          applyToElement(edgeId, annoList);
        }
      }
    });
  }, []);

  const clearAnnotations = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().forEach((ele) => {
        const classes = ele.classes();
        classes.forEach((cls) => {
          if (cls.startsWith('anno-')) ele.removeClass(cls);
        });
      });
    });
  }, []);

  const clearHighlights = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('highlighted dimmed neighbor');
    });
    // Restore the correct dimming layer: isolation if active, else filters.
    if (isolationRef.current && isolatedIdsRef.current) {
      const ids = isolatedIdsRef.current;
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          if (!ids.has(n.id())) n.addClass('dimmed');
        });
        cy.edges().forEach((e) => {
          if (!ids.has(e.source().id()) || !ids.has(e.target().id())) {
            e.addClass('dimmed');
          }
        });
      });
    } else {
      reapplyFilters();
    }
  }, [reapplyFilters]);

  const highlightElements = useCallback((nodeIds, edgeIds = []) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('highlighted');
      nodeIds.forEach((id) => {
        const node = cy.getElementById(id);
        if (node.length) node.addClass('highlighted');
      });
      edgeIds.forEach((id) => {
        const edge = cy.getElementById(id);
        if (edge.length) edge.addClass('highlighted');
      });
    });
  }, []);

  const addElements = useCallback((newElements) => {
    const cy = cyRef.current;
    if (!cy) return 0;
    let addedCount = 0;
    cy.batch(() => {
      for (const el of newElements) {
        const id = el.data?.id;
        if (id && !cy.getElementById(id).length) {
          cy.add(el);
          addedCount++;
        }
      }
      if (addedCount > 0) restoreDimmingState(cy);
    });
    return addedCount;
  }, []);

  const selectNode = useCallback((nodeId) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('neighbor');
      const node = cy.getElementById(nodeId);
      if (node.length) {
        node.select();
        node.neighborhood().nodes().addClass('neighbor');
      }
    });
  }, []);

  const getConnectedEdges = useCallback((nodeId) => {
    const cy = cyRef.current;
    if (!cy) return [];
    const node = cy.getElementById(nodeId);
    if (!node.length) return [];
    return node.connectedEdges().map((e) => {
      const data = e.data();
      // Enrich with the other node's label so DetailPanel can show names, not UUIDs
      const otherId = data.source === nodeId ? data.target : data.source;
      const otherNode = cy.getElementById(otherId);
      return { ...data, _otherLabel: otherNode.length ? otherNode.data('label') : null };
    });
  }, []);

  const LOD_THRESHOLD = 500;

  const removeClustering = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => n.move({ parent: null }));
      cy.nodes('.lod-cluster').remove();
    });
  }, []);

  const applyClustering = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const visibleNodes = cy.nodes(':visible').not(':parent');
    if (visibleNodes.length <= LOD_THRESHOLD) {
      removeClustering();
      return;
    }

    const groups = {};
    visibleNodes.forEach((node) => {
      const type = node.data('type') || 'unknown';
      if (!groups[type]) groups[type] = [];
      groups[type].push(node);
    });

    cy.batch(() => {
      cy.nodes().forEach((n) => {
        if (n.parent().hasClass('lod-cluster')) {
          n.move({ parent: null });
        }
      });
      cy.nodes('.lod-cluster').remove();

      for (const [type, nodes] of Object.entries(groups)) {
        if (nodes.length < 5) continue;

        const clusterId = `__cluster_${type}`;
        cy.add({
          group: 'nodes',
          data: {
            id: clusterId,
            label: `${type} (${nodes.length})`,
            type,
            category: 'cluster',
          },
          classes: 'lod-cluster',
        });

        for (const node of nodes) {
          node.move({ parent: clusterId });
        }
      }
    });
  }, [removeClustering]);

  const setOnNodeClick = useCallback((fn) => { onNodeClickRef.current = fn; }, []);
  const setOnNodeDblClick = useCallback((fn) => { onNodeDblClickRef.current = fn; }, []);
  const setOnNodeHover = useCallback((fn) => { onNodeHoverRef.current = fn; }, []);
  const setOnNodeHoverOut = useCallback((fn) => { onNodeHoverOutRef.current = fn; }, []);
  const setOnBgClick = useCallback((fn) => { onBgClickRef.current = fn; }, []);

  // Toggle pan/select mode. In select mode: box selection enabled, nodes non-grabbable,
  // tap opens box-select instead of detail panel.
  const setSelectionMode = useCallback((enabled) => {
    selectionModeRef.current = enabled;
    setSelectionModeState(enabled);
    const cy = cyRef.current;
    if (!cy) return;
    cy.boxSelectionEnabled(enabled);
    cy.userPanningEnabled(!enabled);
    if (enabled) {
      cy.nodes().ungrabify();
    } else {
      cy.nodes().grabify();
      // Exit selection mode: clear selection, move mode, and isolation
      cy.elements().unselect();
      setSelectedNodeIds(new Set());
      if (moveModeRef.current) {
        moveModeRef.current = false;
        setMoveModeState(false);
      }
      if (isolationRef.current) {
        cy.elements().removeClass('dimmed');
        isolationRef.current = false;
        isolatedIdsRef.current = null;
        setIsolated(false);
        reapplyFilters();
      }
    }
  }, [reapplyFilters]);

  // Select all visible (non-dimmed) nodes
  const selectAll = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().not('.dimmed').select();
  }, []);

  // --- Multi-select actions ---

  // Isolate: dim everything except selected nodes + their connecting edges.
  const [isolated, setIsolated] = useState(false);

  const isolateSelected = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const selected = cy.nodes(':selected');
    if (selected.length === 0) return;

    const selectedIds = new Set(selected.map((n) => n.id()));
    cy.batch(() => {
      // Dim all non-selected nodes
      cy.nodes().forEach((n) => {
        if (!selectedIds.has(n.id())) n.addClass('dimmed');
        else n.removeClass('dimmed');
      });
      // Show edges where both endpoints are selected, dim the rest
      cy.edges().forEach((e) => {
        if (selectedIds.has(e.source().id()) && selectedIds.has(e.target().id())) {
          e.removeClass('dimmed');
        } else {
          e.addClass('dimmed');
        }
      });
    });
    isolationRef.current = true;
    isolatedIdsRef.current = selectedIds;
    setIsolated(true);
    // Fit to the isolated subgraph
    cy.fit(selected, getFitPadding(cy));
  }, []);

  const clearIsolation = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed');
    });
    isolationRef.current = false;
    isolatedIdsRef.current = null;
    setIsolated(false);
    reapplyFilters();
    cy.fit(getFitElements(cy), getFitPadding(cy));
  }, [reapplyFilters]);

  // Move mode: make selected nodes grabbable so they can be dragged as a group.
  // Cytoscape natively moves all :selected nodes when you drag one of them.
  const [moveMode, setMoveModeState] = useState(false);
  const moveModeRef = useRef(false);

  const setMoveMode = useCallback((enabled) => {
    moveModeRef.current = enabled;
    setMoveModeState(enabled);
    const cy = cyRef.current;
    if (!cy) return;
    if (enabled) {
      // Only grabify selected nodes — unselected stay locked
      cy.nodes(':selected').grabify();
      // Disable box selection so drag = move, not select-more
      cy.boxSelectionEnabled(false);
      cy.userPanningEnabled(false);
    } else {
      cy.nodes().ungrabify();
      // Restore selection-mode settings if still in selection mode
      if (selectionModeRef.current) {
        cy.boxSelectionEnabled(true);
        cy.userPanningEnabled(false);
      } else {
        cy.boxSelectionEnabled(false);
        cy.userPanningEnabled(true);
        cy.nodes().grabify();
      }
    }
  }, []);

  // Remove a set of nodes (and their edges) from the graph. Called after backend delete.
  const removeNodes = useCallback((ids) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      ids.forEach((id) => {
        const el = cy.getElementById(id);
        if (el.length) cy.remove(el.closedNeighborhood().filter((e) => e.isEdge()).union(el));
      });
    });
    setSelectedNodeIds(new Set());
  }, []);

  // Re-apply cytoscape styles when the consumer-supplied theme changes.
  // The init effect only runs once (cyRef guard), so without this hook
  // a runtime theme switch (e.g. Obsidian light/dark toggle) would not
  // propagate to the canvas.
  const themeKey = JSON.stringify(theme || null);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !cyReady) return;
    cy.style().fromJson(getCytoscapeStyles(theme)).update();
  }, [themeKey, cyReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize the return object so that only reactive state changes (ready, autoFit,
  // selectedNodeIds, selectionMode, isolated, moveMode) produce a new identity.
  // Without this, every render creates a new object and downstream effects that
  // depend on `cytoscape` (filters, clustering, annotations) re-fire spuriously.
  return useMemo(() => ({
    cy: cyRef,
    ready: cyReady,
    setContainerRef,
    setElements,
    mergeElements,
    addElements,
    runLayout,
    zoomIn,
    zoomOut,
    fitToScreen,
    applyFilter,
    applyAnnotations,
    clearAnnotations,
    clearHighlights,
    highlightElements,
    selectNode,
    getConnectedEdges,
    applyClustering,
    removeClustering,
    setOnNodeClick,
    setOnNodeDblClick,
    setOnNodeHover,
    setOnNodeHoverOut,
    setOnBgClick,
    autoFit,
    setAutoFit,
    selectedNodeIds,
    removeNodes,
    selectAll,
    selectionMode,
    setSelectionMode,
    isolateSelected,
    clearIsolation,
    isolated,
    moveMode,
    setMoveMode,
  }), [cyReady, autoFit, selectedNodeIds, selectionMode, isolated, moveMode]);
}
