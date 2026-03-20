import { describe, it, expect } from "bun:test"
import { PlaceholderGuard } from "../core/PlaceholderGuard"

describe("PlaceholderGuard", () => {
  it("should create unique placeholders", () => {
    PlaceholderGuard.clearPlaceholders()
    const p1 = PlaceholderGuard.createPlaceholder("QUERY")
    const p2 = PlaceholderGuard.createPlaceholder("QUERY")

    expect(p1).not.toBe(p2)
    expect(p1).toMatch(/^{{QUERY.*}}$/)
    expect(p2).toMatch(/^{{QUERY.*}}$/)
  })

  it("should prevent placeholder collision attacks", () => {
    PlaceholderGuard.clearPlaceholders()
    const placeholder = PlaceholderGuard.createPlaceholder("CONTEXT")

    // User tries to inject the placeholder name
    const injected = `{{CONTEXT}}`

    // They should NOT be able to match the actual placeholder
    expect(injected).not.toBe(placeholder)
  })

  it("should safely replace placeholders", () => {
    PlaceholderGuard.clearPlaceholders()
    const p1 = PlaceholderGuard.createPlaceholder("QUERY")
    const p2 = PlaceholderGuard.createPlaceholder("CONTEXT")

    const template = `Question: ${p1}, Data: ${p2}`
    const result = PlaceholderGuard.safeReplace(template, {
      [p1]: "What is the answer?",
      [p2]: "The answer is 42",
    })

    expect(result).toBe("Question: What is the answer?, Data: The answer is 42")
  })

  it("should protect user input from injection", () => {
    PlaceholderGuard.clearPlaceholders()
    const { protected: protectedInput, restore } = PlaceholderGuard.protectUserInput("What is {{CONTEXT}}?")

    // protectedInput is a UUID-based placeholder
    expect(protectedInput).toMatch(/^{{USER_INPUT.*}}$/)
    expect(protectedInput).not.toBe("What is {{CONTEXT}}?")

    // restore function puts the original back
    const restored = restore(`The question is: ${protectedInput}`)
    expect(restored).toContain("What is {{CONTEXT}}?")
  })

  it("should track registered placeholders", () => {
    PlaceholderGuard.clearPlaceholders()
    const p1 = PlaceholderGuard.createPlaceholder("QUERY")
    const p2 = PlaceholderGuard.createPlaceholder("CONTEXT")

    const placeholders = PlaceholderGuard.getPlaceholders()
    expect(placeholders.size).toBe(2)
    expect(placeholders.has(p1)).toBe(true)
    expect(placeholders.has(p2)).toBe(true)
  })

  it("should clear placeholders", () => {
    PlaceholderGuard.clearPlaceholders()
    PlaceholderGuard.createPlaceholder("QUERY")

    let placeholders = PlaceholderGuard.getPlaceholders()
    expect(placeholders.size).toBe(1)

    PlaceholderGuard.clearPlaceholders()
    placeholders = PlaceholderGuard.getPlaceholders()
    expect(placeholders.size).toBe(0)
  })

  it("should handle multiple replacements of same placeholder", () => {
    PlaceholderGuard.clearPlaceholders()
    const p = PlaceholderGuard.createPlaceholder("VAR")

    const template = `${p} and ${p} and ${p}`
    const result = PlaceholderGuard.safeReplace(template, {
      [p]: "value",
    })

    expect(result).toBe("value and value and value")
  })

  it("should handle missing placeholder in replacement", () => {
    PlaceholderGuard.clearPlaceholders()
    const p1 = PlaceholderGuard.createPlaceholder("QUERY")
    const p2 = PlaceholderGuard.createPlaceholder("CONTEXT")

    const template = `${p1} and ${p2}`
    // Only replace p1, leave p2 as-is
    const result = PlaceholderGuard.safeReplace(template, {
      [p1]: "replaced",
    })

    expect(result).toContain("replaced")
    expect(result).toContain(p2) // p2 should still be in the result
  })
})
