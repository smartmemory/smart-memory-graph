import { useState, useEffect, useRef } from 'react';
import { searchWikipedia } from '../core/wikipedia';

/**
 * Entity correction logic extracted from DetailPanel (R3).
 * Handles type changes, label renames, and Wikipedia grounding.
 *
 * @param {Object} options
 * @param {Object} options.node - Selected node data
 * @param {Object} options.adapter - GraphAPIAdapter for API calls
 * @param {function} options.onNodeUpdate - Callback to update node in graph: (nodeId, updates) => void
 */
export function useEntityCorrections({ node, adapter, onNodeUpdate }) {
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [customType, setCustomType] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [typeSaved, setTypeSaved] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState(null);
  const [groundingError, setGroundingError] = useState(null);
  const [wikiError, setWikiError] = useState(null);
  const savingRef = useRef(false);
  const saveTimer = useRef(null);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Grounding state
  const [grounding, setGrounding] = useState(null);
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [wikiResults, setWikiResults] = useState(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [showWikiOverlay, setShowWikiOverlay] = useState(false);

  const labelInputRef = useRef(null);
  const nodeId = node?.id;

  // Reset state when the selected node changes
  useEffect(() => {
    setTypeDropdownOpen(false);
    setEditingLabel(false);
    setTypeSaved(false);
    setLabelSaved(false);
    setGrounding(null);
    setShowWikiOverlay(false);
    setWikiResults(null);
  }, [nodeId]);

  // Fetch grounding status on node change
  useEffect(() => {
    if (!nodeId || !adapter?.getGroundingStatus) return;
    setGroundingError(null);
    let cancelled = false;
    setGroundingLoading(true);
    adapter.getGroundingStatus(nodeId)
      .then((data) => { if (!cancelled) setGrounding(data); })
      .catch(() => { if (!cancelled) setGroundingError('Could not load grounding status.'); })
      .finally(() => { if (!cancelled) setGroundingLoading(false); });
    return () => { cancelled = true; };
  }, [nodeId, adapter]);

  // Focus label input when editing starts
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  async function saveCorrection(updates, setSaved, learnRename) {
    if (savingRef.current || !adapter?.updateEntityNode) return;
    savingRef.current = true;
    setSaving(true);
    setCorrectionError(null);
    setTypeSaved(false);
    setLabelSaved(false);
    clearTimeout(saveTimer.current);
    try {
      await adapter.updateEntityNode(node.id, updates);
      const displayUpdates = updates.entity_type ? { ...updates, type: updates.entity_type } : updates;
      onNodeUpdate?.(node.id, displayUpdates);
      if (learnRename && adapter.createOntologyPattern) {
        try {
          await adapter.createOntologyPattern(updates.label, node.type, 1.0);
        } catch {
          setCorrectionError('Name saved. Could not update the ontology pattern.');
          return;
        }
      }
      setSaved(true);
      saveTimer.current = setTimeout(() => setSaved(false), 1500);
    } catch {
      setCorrectionError('Could not save the entity change.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleTypeChange(newType) {
    setTypeDropdownOpen(false);
    setCustomType('');
    if (!newType || newType === node.type) return;
    // PATCH already registers a correction pattern for a type change.
    await saveCorrection({ entity_type: newType }, setTypeSaved, false);
  }

  async function handleLabelSave() {
    setEditingLabel(false);
    const newLabel = labelValue.trim();
    if (!newLabel || newLabel === node.label) return;
    await saveCorrection({ label: newLabel }, setLabelSaved, true);
  }

  async function handleGround() {
    setWikiLoading(true);
    setWikiError(null);
    setShowWikiOverlay(true);
    try {
      const results = await searchWikipedia(node.label);
      setWikiResults(Array.isArray(results) ? results : []);
    } catch {
      setWikiError('Could not search Wikipedia.');
    } finally {
      setWikiLoading(false);
    }
  }

  async function handleUnground() {
    try {
      await adapter.removeGrounding(node.id);
      setGrounding({ grounded: false, wikipedia: null });
    } catch {
      setGroundingError('Could not remove grounding.');
    }
  }

  // Kept for callers of the exported hook. No endpoint persists a selected article.
  async function handleGroundAccept() {
    setWikiError('Saving a Wikipedia match is coming soon.');
  }

  return {
    // State
    typeDropdownOpen, setTypeDropdownOpen,
    customType, setCustomType,
    editingLabel, setEditingLabel,
    labelValue, setLabelValue,
    typeSaved, labelSaved, saving, correctionError, groundingError, wikiError,
    grounding, groundingLoading,
    wikiResults, wikiLoading,
    showWikiOverlay, setShowWikiOverlay,
    labelInputRef,
    // Handlers
    handleTypeChange,
    handleLabelSave,
    handleGround,
    handleUnground,
    handleGroundAccept,
  };
}
