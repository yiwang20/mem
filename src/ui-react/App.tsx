import { HashRouter, Routes, Route } from 'react-router-dom';
import { useWebSocket } from './lib/websocket.js';
import { ToastProvider } from './components/Toast.js';
import { TopBar } from './components/TopBar.js';
import { Sidebar } from './components/Sidebar.js';
import { CommandPalette } from './components/CommandPalette.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { MainView } from './views/MainView.js';
import { EntityView } from './views/EntityView.js';
import { SearchView } from './views/SearchView.js';

// ---------------------------------------------------------------------------
// WebSocket connection — top-level, inside HashRouter
// ---------------------------------------------------------------------------

function WebSocketManager() {
  useWebSocket();
  return null;
}

// ---------------------------------------------------------------------------
// Shell layout
// ---------------------------------------------------------------------------

function Shell() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* Top bar — full width, fixed height */}
      <TopBar />

      {/* Below top bar: sidebar + main content side by side */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />

        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Routes>
            <Route path="/" element={<MainView />} />
            <Route path="/entity/:id" element={<EntityView />} />
            <Route path="/search" element={<SearchView />} />
            {/* Fallback */}
            <Route path="*" element={<MainView />} />
          </Routes>
        </main>
      </div>

      <CommandPalette />
      <SettingsPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <WebSocketManager />
        <Shell />
      </HashRouter>
    </ToastProvider>
  );
}
