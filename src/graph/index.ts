export { EntityResolver } from './entity-resolver.js';
export type { ResolvedEntity, ResolutionDecision } from './entity-resolver.js';

export { EntityMerger } from './merger.js';

export { GraphOperations } from './operations.js';
export type { TimelineFilters, EntityStats } from './operations.js';

export { CommunityDetector } from './community.js';
export type { DetectedCommunity } from './community.js';

export { TopicClusterer } from './clustering.js';
export type { ClusterResult, ClusteringStats } from './clustering.js';

export {
  jaroWinkler,
  toPinyin,
  normalizePhone,
  normalizeEmail,
  nameSimilarity,
} from './name-utils.js';
