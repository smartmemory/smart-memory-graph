import { useState } from 'react';

export default function SuggestedLinkActions({ source, target, actions }) {
  const [choice, setChoice] = useState(null);
  const apply = choice === 'confirm' ? actions.onConfirmLink : actions.onRemoveLink;
  function save() {
    if (apply) apply(source, target);
    setChoice(null);
  }
  if (choice && apply) return <div>
    <p>{choice === 'confirm' ? 'Saving confirms this dependency.' : 'Saving removes this dependency.'}</p>
    <button onClick={save}>Save link change</button>
    <button onClick={() => setChoice(null)}>Discard link change</button>
  </div>;
  return <div className="de-actions">
    {actions.onConfirmLink && <button onClick={() => setChoice('confirm')}>Confirm</button>}
    {actions.onRemoveLink && <button onClick={() => setChoice('remove')}>Remove</button>}
  </div>;
}
