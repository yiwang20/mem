import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
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

.mf-overview-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.mf-overview-content h1,
.mf-overview-content h2,
.mf-overview-content h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 10px 0 4px 0;
}

.mf-overview-content h1:first-child,
.mf-overview-content h2:first-child,
.mf-overview-content h3:first-child {
  margin-top: 0;
}

.mf-overview-content p {
  margin: 0 0 8px 0;
}

.mf-overview-content p:last-child {
  margin-bottom: 0;
}

.mf-overview-content ul {
  margin: 4px 0 8px 0;
  padding-left: 20px;
}

.mf-overview-content li {
  margin-bottom: 4px;
}

.mf-overview-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
}

.mf-overview-link:hover {
  text-decoration-style: solid;
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

  // Custom link renderer for source: and entity: links
  const renderLink = useCallback(
    (props: { href?: string; children?: React.ReactNode }) => {
      const href = props.href ?? '';
      if (href.startsWith('source:')) {
        const id = href.slice(7);
        return (
          <a className="mf-overview-link" onClick={(e) => { e.preventDefault(); navigate(`/items/${id}`); }} href="#">
            {props.children}
          </a>
        );
      }
      if (href.startsWith('entity:')) {
        const id = href.slice(7);
        return (
          <a className="mf-overview-link" onClick={(e) => { e.preventDefault(); navigate(`/entities/${id}`); }} href="#">
            {props.children}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{props.children}</a>;
    },
    [navigate],
  );

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

  return (
    <div className="mf-overview">
      <div className="mf-overview-content">
        <ReactMarkdown
          components={{ a: renderLink }}
          urlTransform={(url) => url}
        >
          {data.overview.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
