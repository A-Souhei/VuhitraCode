/**
 * Formats data context with XML source tagging (auto-numbered IDs)
 * Pattern from Open WebUI: /backend/open_webui/utils/middleware.py lines 893-916
 *
 * Prevents hallucination by:
 * 1. Making all sources traceable via ID numbers
 * 2. Forcing model to cite [1], [2], etc. when making claims
 * 3. Allowing caller to verify claims against known sources
 */

import type { SourceContext, FormattedSource } from "./types"

export class SourceFormatter {
  /**
   * Format context sources with auto-numbered XML tags
   *
   * Input:  { "file.csv": "data...", "analysis.txt": "results..." }
   * Output: <source id="1" name="file.csv">data...</source>\n<source id="2" name="analysis.txt">results...</source>
   */
  static format(sources: SourceContext): { xml: string; metadata: FormattedSource[] } {
    const metadata: FormattedSource[] = []
    let xml = ""
    let id = 1

    for (const [name, content] of Object.entries(sources)) {
      const formatted: FormattedSource = {
        id,
        name,
        content,
        xml: `<source id="${id}" name="${this.escapeXml(name)}">${this.escapeXml(content)}</source>`,
      }
      metadata.push(formatted)
      xml += formatted.xml + "\n"
      id++
    }

    return { xml: xml.trim(), metadata }
  }

  /**
   * Extract source citations from a response
   * Looks for patterns like [1], [2], [id] in the text
   */
  static extractCitations(text: string): number[] {
    const citations: number[] = []
    const pattern = /\[(\d+)\]/g
    let match

    while ((match = pattern.exec(text)) !== null) {
      const id = parseInt(match[1], 10)
      if (!citations.includes(id)) {
        citations.push(id)
      }
    }

    return citations
  }

  /**
   * Verify that all citations in a response refer to known sources
   * Returns false if model cites [5] but only 3 sources provided
   */
  static verifyCitations(text: string, sourceCount: number): { valid: boolean; invalidCitations: number[] } {
    const citations = this.extractCitations(text)
    const invalidCitations = citations.filter((id) => id > sourceCount || id < 1)

    return {
      valid: invalidCitations.length === 0,
      invalidCitations,
    }
  }

  private static escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }
}
