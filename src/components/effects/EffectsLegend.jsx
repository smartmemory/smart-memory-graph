const entries = [
  ['decision', 'Decision in force'], ['note', 'Source note'], ['proposed', 'Proposed (not saved)'],
  ['retired', 'Replaced'], ['conflict', 'Conflict'], ['review', 'Needs review'],
  ['depends', 'Depends on'], ['source', 'Comes from a note'],
];

export default function EffectsLegend() {
  return <section className="de-legend" aria-label="Legend"><h3>Legend</h3>
    <ul>{entries.map(([kind, label]) => <li key={kind}>
      <i aria-hidden="true" className={'de-key de-key-' + kind} />{label}
    </li>)}</ul>
  </section>;
}
