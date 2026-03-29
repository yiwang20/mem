import { useAppStore } from '../lib/store.js';
import type { ActiveTab } from '../lib/store.js';
import { TopicsTreeView } from './TopicsTreeView.js';
import { ContactsListView } from './ContactsListView.js';
import { TodoListView } from './TodoListView.js';

// ---------------------------------------------------------------------------
// Tab label config — for the header bar
// ---------------------------------------------------------------------------

const TAB_LABELS: Record<ActiveTab, { en: string; zh: string }> = {
  todo:     { en: 'Todo',     zh: '待办'  },
  contacts: { en: 'Contacts', zh: '联系人' },
  topics:   { en: 'Topics',   zh: '话题'  },
};

// ---------------------------------------------------------------------------
// Header bar — tab title, sits at the top of the main content area
// ---------------------------------------------------------------------------

function ContentHeader({ tab }: { tab: ActiveTab }) {
  const { en, zh } = TAB_LABELS[tab];
  return (
    <div
      style={{
        height: '40px',
        backgroundColor: 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
        {en}
      </span>
      <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
        {zh}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MainView — default "/" route
// Renders the active tab's list view below a simple header bar.
// ---------------------------------------------------------------------------

export function MainView() {
  const { activeTab } = useAppStore();

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--bg)',
      }}
    >
      <ContentHeader tab={activeTab} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'topics'   && <TopicsTreeView />}
        {activeTab === 'contacts' && <ContactsListView />}
        {activeTab === 'todo'     && <TodoListView />}
      </div>
    </div>
  );
}
