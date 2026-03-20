/**
 * Main anti-hallucination orchestrator
 * Combines all techniques from Open WebUI into a single, easy-to-use class
 */

import { SourceFormatter } from "./SourceFormatter"
import { PlaceholderGuard } from "./PlaceholderGuard"
import type { GroundingConfig, SourceContext, GroundedPrompt, OllamaRequest, HallucinationCheckResult } from "./types"

export class HallucinationGrounder {
  private config: Required<Omit<GroundingConfig, "seed">> & Pick<GroundingConfig, "seed">

  constructor(config: GroundingConfig = {}) {
    this.config = {
      temperature: config.temperature ?? 0.3,
      topP: config.topP ?? 0.9,
      topK: config.topK ?? 50,
      repeatPenalty: config.repeatPenalty ?? 1.1,
      numCtx: config.numCtx ?? 4096,
      seed: config.seed,
      numPredict: config.numPredict ?? 2048,
    }
  }

  /**
   * Ground a prompt with context and system instructions
   * This is the main entry point for anti-hallucination
   */
  groundPrompt(query: string, sources: SourceContext, systemPrompt: string): GroundedPrompt {
    // Format sources with auto-numbered XML tags
    const { xml: formattedContext, metadata: sourceMetadata } = SourceFormatter.format(sources)

    // Create the RAG template with context injection
    const ragTemplate = this.buildRagTemplate(formattedContext, query, systemPrompt)

    return {
      query,
      systemPrompt,
      context: formattedContext,
      final: ragTemplate,
      sources: sourceMetadata,
    }
  }

  /**
   * Build the RAG template (from Open WebUI DEFAULT_RAG_TEMPLATE)
   */
  private buildRagTemplate(context: string, query: string, systemPrompt: string): string {
    const fullSystemPrompt = `${systemPrompt}

---

CONTEXT TO ANSWER FROM:
${context}

---

USER QUESTION:
${query}`

    return fullSystemPrompt
  }

  /**
   * Get Ollama API request parameters for anti-hallucination
   * These parameters are tuned to reduce hallucination while maintaining coherence
   */
  getOllamaParams(): NonNullable<OllamaRequest["options"]> {
    return {
      temperature: this.config.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      repeat_penalty: this.config.repeatPenalty,
      num_ctx: this.config.numCtx,
      num_predict: this.config.numPredict,
      ...(this.config.seed !== undefined && { seed: this.config.seed }),
      repeat_last_n: 64, // Check last 64 tokens for repetition
      min_p: 0.05, // Minimum probability threshold
    }
  }

  /**
   * Check if a response contains hallucinations
   * Validates that citations refer to known sources
   */
  checkForHallucinations(response: string, sourceCount: number): HallucinationCheckResult {
    const issues: HallucinationCheckResult["issues"] = []
    let passes = true

    // Check 1: Verify citations refer to known sources
    const citationCheck = SourceFormatter.verifyCitations(response, sourceCount)
    if (!citationCheck.valid) {
      passes = false
      issues.push({
        type: "missing_source_id",
        severity: "critical",
        description: `Response cites sources ${citationCheck.invalidCitations.join(", ")} but only ${sourceCount} sources provided`,
      })
    }

    // Check 2: Detect unsourced claims (heuristic)
    const unsourcedPattern =
      /\b(it appears|it seems|likely|probably|may|might|according to\s+(?!sources?|context)|as I understand)\b/gi
    const unsourcedMatches = response.match(unsourcedPattern)
    if (unsourcedMatches && unsourcedMatches.length > 2) {
      passes = false
      issues.push({
        type: "unsourced_claim",
        severity: "major",
        description: `Response contains ${unsourcedMatches.length} speculative phrases without source citations`,
        location: unsourcedMatches.slice(0, 3).join(", "),
      })
    }

    // Check 3: Detect uncertainty hedging that wasn't explicitly in context
    if (response.includes("I don't have enough information") && sourceCount > 0) {
      issues.push({
        type: "uncertainty",
        severity: "minor",
        description: "Model reports insufficient information despite provided context",
      })
    }

    return {
      passes,
      issues,
      recommendations: this.generateRecommendations(issues),
    }
  }

  private generateRecommendations(issues: HallucinationCheckResult["issues"]): string[] {
    const recs: string[] = []

    for (const issue of issues) {
      if (issue.type === "missing_source_id") {
        recs.push("Ensure all sources are provided to the model in XML format with id attributes")
      } else if (issue.type === "unsourced_claim") {
        recs.push('Add explicit grounding instruction: "Only answer from provided context"')
        recs.push("Lower temperature further (try 0.1 instead of 0.3)")
      } else if (issue.type === "uncertainty") {
        recs.push("Verify that source content actually contains the answer")
      }
    }

    return recs
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GroundingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): GroundingConfig {
    return { ...this.config }
  }
}
