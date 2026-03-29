export { AttentionEngine } from './engine.js';
export type { AttentionEngineOptions } from './engine.js';

export {
  timeDecay,
  combineSignals,
  clamp,
  lerp,
  deadlineScore,
  staleConversationScore,
} from './scoring.js';

export { detectUnansweredRequests } from './rules/unanswered.js';
export { detectApproachingDeadlines } from './rules/deadlines.js';
export { detectStaleConversations } from './rules/stale.js';
