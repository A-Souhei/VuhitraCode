/**
 * Core anti-hallucination utilities exports
 */

export { HallucinationGrounder } from "./HallucinationGrounder"
export { SourceFormatter } from "./SourceFormatter"
export { PlaceholderGuard } from "./PlaceholderGuard"
export type {
  GroundingConfig,
  SourceContext,
  FormattedSource,
  GroundedPrompt,
  MessageHierarchy,
  HallucinationCheckResult,
  OllamaRequest,
} from "./types"
