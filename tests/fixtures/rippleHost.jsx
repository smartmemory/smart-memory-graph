import { createRoot } from 'react-dom/client';
import GraphExplorer from '../../src/components/GraphExplorer';
import { createFetchAdapter } from '../../src/adapters/fetchAdapter';

const adapter = createFetchAdapter({ apiUrl: location.origin, getTeamId: () => 'ripple', getToken: () => null });
const root = createRoot(document.querySelector('main'));
window.setGraphMode = mode => root.render(<GraphExplorer adapter={adapter} mode={mode} />);
window.setGraphMode('light');
