/**
 * Core types for anti-hallucination grounding
 * Ported from Open WebUI patterns
 */

export interface GroundingConfig {
  /** Ollama/model temperature: 0.0-1.0. Lower = more factual. Default: 0.3 */
  temperature?: number

  /** Nucleus sampling: 0.0-1.0. Default: 0.9 */
  topP?: number

  /** Top-K sampling: typically 40-50. Default: 50 */
  topK?: number

  /** Repetition penalty: 1.0-2.0. Higher = less repetition. Default: 1.1 */
  repeatPenalty?: number

  /** Context window size in tokens. Default: 4096 */
  numCtx?: number

  /** Seed for reproducibility. Optional. */
  seed?: number

  /** Max tokens to generate. Default: 2048 */
  numPredict?: number
}

export interface SourceContext {
  /** Map of source name to content */
  [sourceName: string]: string
}

export interface FormattedSource {
  id: number
  name: string
  content: string
  xml: string // `<source id="1" name="name">content</source>`
}

export interface GroundedPrompt {
  /** The original user query */
  query: string

  /** The system prompt with grounding instructions */
  systemPrompt: string

  /** The formatted context with sources */
  context: string

  /** The final combined prompt ready for model */
  final: string

  /** Metadata about sources for verification */
  sources: FormattedSource[]
}

export interface MessageHierarchy {
  /** System message (always position 0) */
  system: string

  /** User messages with their order */
  userMessages: string[]

  /** Assistant responses with their order */
  assistantMessages: string[]

  /** Current user query (always last) */
  currentQuery: string
}

export interface HallucinationCheckResult {
  /** Whether the response passes the check */
  passes: boolean

  /** List of issues detected */
  issues: {
    type: "unsourced_claim" | "missing_source_id" | "fabricated_data" | "repetition" | "uncertainty"
    severity: "critical" | "major" | "minor"
    description: string
    location?: string // Line or excerpt from response
  }[]

  /** Recommendations for fixing */
  recommendations?: string[]
}

export interface OllamaRequest {
  model: string
  prompt: string
  stream?: boolean
  options?: {
    temperature?: number
    top_p?: number
    top_k?: number
    repeat_penalty?: number
    num_ctx?: number
    num_predict?: number
    seed?: number
    repeat_last_n?: number
    min_p?: number
  }
}
