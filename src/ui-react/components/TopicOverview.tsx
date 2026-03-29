import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Inject overview styles once
// ---------------------------------------------------------------------------

const OVERVIEW_CSS = `
.mf-overview {
  background: var(--bg-subtle);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.mf-overview-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
}

.mf-overview-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
  background: none;
  border: none;
  font-size: inherit;
  font-family: inherit;
  line-height: inherit;
  padding: 0;
}

.mf-overview-skeleton-line {
  height: 13px;
  border-radius: 4px;
  background: var(--bg);
  animation: shimmer 1.5s infinite;
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = OVERVIEW_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Source link parsing
// ---------------------------------------------------------------------------

// Matches [text](source:RAW_ITEM_ID)
const SOURCE_LINK_RE = /\[([^\]]+)\]\(source:([^)]+)\)/g;

interface OverviewSegment {
  type: 'text' | 'link';
  text: string;
  rawItemId?: string;
}

function parseOverviewContent(content: string): OverviewSegment[] {
  const segments: OverviewSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  SOURCE_LINK_RE.lastIndex = 0;
  while ((match = SOURCE_LINK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'link', text: match[1], rawItemId: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// TopicOverview
// ---------------------------------------------------------------------------

export interface TopicOverviewProps {
  topicId: string;
  topicStatus: string;
}

export function TopicOverview({ topicId, topicStatus }: TopicOverviewProps) {
  useEffect(() => { injectCss(); }, []);

  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['topic-overview', topicId],
    queryFn: () => api.getTopicOverview(topicId),
    enabled: topicStatus !== 'archived',
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mf-overview">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="mf-overview-skeleton-line" style={{ width: '100%' }} />
          <div className="mf-overview-skeleton-line" style={{ width: '85%' }} />
          <div className="mf-overview-skeleton-line" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  if (!data?.overview) return null;

  const segments = parseOverviewContent(data.overview.content);

  return (
    <div className="mf-overview">
      <p className="mf-overview-text">
        {segments.map((seg, i) => {
          if (seg.type === 'link' && seg.rawItemId) {
            return (
              <button
                key={i}
                className="mf-overview-link"
                onClick={() => navigate(`/items/${seg.rawItemId}`)}
              >
                {seg.text}
              </button>
            );
          }
          return <span key={i}>{seg.text}</span>;
        })}
      </p>
    </div>
  );
}
