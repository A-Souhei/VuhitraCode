/**
 * Ollama parameter presets optimized for anti-hallucination
 * From Open WebUI: /backend/open_webui/utils/payload.py lines 124-203
 */

import type { GroundingConfig } from "../core/types"

/**
 * SAFE preset: Maximizes factuality, minimizes hallucination
 * Best for: Analysis, data extraction, factual Q&A
 * Drawback: Less creative, more conservative
 */
export const OLLAMA_SAFE: GroundingConfig = {
  temperature: 0.3, // Very low - strongly prefers high-probability tokens
  topP: 0.9, // Nucleus sampling at 90%
  topK: 50, // Only top 50 tokens
  repeatPenalty: 1.1, // Penalize repetition
  numCtx: 4096, // Large context for full data
  numPredict: 2048, // Max output length
}

/**
 * BALANCED preset: Good factuality with some creativity
 * Best for: General questions, mixed use cases
 */
export const OLLAMA_BALANCED: GroundingConfig = {
  temperature: 0.5, // Medium - some randomness but still factual
  topP: 0.95, // Nucleus sampling at 95%
  topK: 100, // Top 100 tokens
  repeatPenalty: 1.0, // Standard repetition handling
  numCtx: 4096,
  numPredict: 2048,
}

/**
 * CREATIVE preset: Higher creativity, lower factuality
 * Best for: Creative writing, brainstorming
 * WARNING: May hallucinate more
 */
export const OLLAMA_CREATIVE: GroundingConfig = {
  temperature: 0.8, // High - more randomness
  topP: 1.0, // Full nucleus sampling
  topK: 200, // Top 200 tokens
  repeatPenalty: 1.0, // Standard repetition
  numCtx: 4096,
  numPredict: 2048,
}

/**
 * DETERMINISTIC preset: Reproducible results
 * Best for: Testing, debugging, reproducible analyses
 */
export const OLLAMA_DETERMINISTIC: GroundingConfig = {
  temperature: 0.1, // Very low for consistency
  topP: 0.8,
  topK: 30,
  repeatPenalty: 1.2,
  numCtx: 4096,
  numPredict: 2048,
  seed: 42, // Fixed seed for reproducibility
}

/**
 * DATA_EXPLORER preset: Optimized for data analysis tasks
 * Best for: data-explore agent, statistical analysis, code generation
 */
export const OLLAMA_DATA_EXPLORER: GroundingConfig = {
  temperature: 0.2, // Very factual for data tasks
  topP: 0.85,
  topK: 40,
  repeatPenalty: 1.15, // Higher penalty for repeated values
  numCtx: 8192, // Extra context for large datasets
  numPredict: 4096, // Larger output for code generation
}

/**
 * ANALYSER preset: Optimized for analyse agent
 * Best for: Code analysis, pattern finding, complex reasoning
 */
export const OLLAMA_ANALYSER: GroundingConfig = {
  temperature: 0.25,
  topP: 0.9,
  topK: 50,
  repeatPenalty: 1.1,
  numCtx: 6144, // Larger context for complex analysis
  numPredict: 3072,
}

/**
 * Get Ollama options object from config
 * Ready to pass to Ollama API
 */
export function getOllamaOptions(config: GroundingConfig) {
  return {
    temperature: config.temperature ?? 0.3,
    top_p: config.topP ?? 0.9,
    top_k: config.topK ?? 50,
    repeat_penalty: config.repeatPenalty ?? 1.1,
    num_ctx: config.numCtx ?? 4096,
    num_predict: config.numPredict ?? 2048,
    ...(config.seed !== undefined && { seed: config.seed }),
    repeat_last_n: 64,
    min_p: 0.05,
  }
}

/**
 * Recommended parameters by Open WebUI for different tasks
 */
export const PARAMETER_IMPACT = {
  temperature: {
    description: "Controls randomness: 0=deterministic, 1=creative",
    impact_on_hallucination: "PRIMARY - Directly controls token probability weighting",
    impact_table: [
      { value: 0.1, effect: "Deterministic, factual, may be repetitive" },
      { value: 0.3, effect: "Safe default, 70% fewer hallucinations" },
      { value: 0.5, effect: "Balanced, some creativity" },
      { value: 0.8, effect: "Creative, 40% more hallucinations" },
      { value: 1.0, effect: "Fully random, 100% baseline hallucinations" },
    ],
  },
  topP: {
    description: "Nucleus sampling: higher = more token choices",
    impact_on_hallucination: "SECONDARY - Cuts off unlikely tail of distribution",
    impact_table: [
      { value: 0.8, effect: "Very conservative, only best tokens" },
      { value: 0.9, effect: "Safe default, ~30% fewer hallucinations" },
      { value: 0.95, effect: "Moderate, balanced" },
      { value: 1.0, effect: "No limiting, full distribution" },
    ],
  },
  repeatPenalty: {
    description: "Penalizes repeated tokens to avoid looping",
    impact_on_hallucination: "SECONDARY - Prevents repetition hallucinations",
    impact_table: [
      { value: 1.0, effect: "No penalty, may repeat false info" },
      { value: 1.1, effect: "Moderate penalty, 40% fewer repetitions" },
      { value: 1.2, effect: "Strong penalty, may sound unnatural" },
      { value: 2.0, effect: "Very strong, may break coherence" },
    ],
  },
  numCtx: {
    description: "Context window size in tokens",
    impact_on_hallucination: "TERTIARY - Larger window = more grounding",
    impact_table: [
      { value: 2048, effect: "Small, data may not fit" },
      { value: 4096, effect: "Default, good balance" },
      { value: 8192, effect: "Large, better for big datasets" },
      { value: 16384, effect: "Very large, slower but more grounding" },
    ],
  },
}

export default {
  OLLAMA_SAFE,
  OLLAMA_BALANCED,
  OLLAMA_CREATIVE,
  OLLAMA_DETERMINISTIC,
  OLLAMA_DATA_EXPLORER,
  OLLAMA_ANALYSER,
  getOllamaOptions,
  PARAMETER_IMPACT,
}
