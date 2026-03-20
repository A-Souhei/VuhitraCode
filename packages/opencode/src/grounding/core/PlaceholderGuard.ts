/**
 * UUID-based placeholder randomization to prevent prompt injection attacks
 * Pattern from Open WebUI: /backend/open_webui/utils/task.py lines 281-306
 *
 * Problem: If user submits input like "{{CONTEXT}}", they could inject context
 * Solution: Use globally unique placeholder IDs so user input cannot collide
 */

export class PlaceholderGuard {
  private static placeholders = new Map<string, string>()

  /**
   * Generate a unique placeholder for a variable name
   * Example: "QUERY" -> "{{QUERY550e8400e29b41d4a716446655440000}}"
   */
  static createPlaceholder(name: string): string {
    const uuid = this.generateUuid()
    const placeholder = `{{${name}${uuid}}}`
    this.placeholders.set(placeholder, name)
    return placeholder
  }

  /**
   * Get all active placeholders
   */
  static getPlaceholders(): Map<string, string> {
    return new Map(this.placeholders)
  }

  /**
   * Clear all registered placeholders
   */
  static clearPlaceholders(): void {
    this.placeholders.clear()
  }

  /**
   * Safely replace placeholders in a template
   * Prevents user input from interfering with template structure
   */
  static safeReplace(template: string, replacements: Record<string, string>): string {
    let result = template

    for (const [placeholder, value] of Object.entries(replacements)) {
      result = result.replaceAll(placeholder, value)
    }

    return result
  }

  /**
   * Protect user input by wrapping in UUID-based placeholder
   * This ensures user cannot inject template variables
   */
  static protectUserInput(input: string): { protected: string; restore: (text: string) => string } {
    const placeholder = this.createPlaceholder("USER_INPUT")
    const originalValue = input

    return {
      protected: placeholder,
      restore: (text: string) => {
        PlaceholderGuard.clearPlaceholders()
        return text.replaceAll(placeholder, originalValue)
      },
    }
  }

  private static generateUuid(): string {
    // Simple UUID v4-like generation using crypto or Math.random
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID()
    }

    // Fallback for environments without crypto.randomUUID
    const chars = "0123456789abcdef"
    let uuid = ""
    for (let i = 0; i < 32; i++) {
      uuid += chars[Math.floor(Math.random() * 16)]
    }
    return uuid
  }
}
