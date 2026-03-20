import { describe, it, expect } from "bun:test"
import { HallucinationGrounder } from "../core/HallucinationGrounder"

describe("HallucinationGrounder", () => {
  it("should ground a prompt with context and system message", () => {
    const grounder = new HallucinationGrounder()
    const sources = {
      "data.csv": "col1,col2\n10,20\n30,40",
    }

    const grounded = grounder.groundPrompt("What is the average?", sources, "You are a data analyst.")

    expect(grounded.query).toBe("What is the average?")
    expect(grounded.systemPrompt).toBe("You are a data analyst.")
    expect(grounded.context).toContain('<source id="1"')
    expect(grounded.final).toContain("You are a data analyst.")
    expect(grounded.final).toContain('<source id="1"')
    expect(grounded.final).toContain("What is the average?")
  })

  it("should apply safe anti-hallucination parameters", () => {
    const grounder = new HallucinationGrounder({
      temperature: 0.3,
      topP: 0.9,
      repeatPenalty: 1.1,
    })

    const params = grounder.getOllamaParams()

    expect(params.temperature).toBe(0.3)
    expect(params.top_p).toBe(0.9)
    expect(params.repeat_penalty).toBe(1.1)
    expect(params.num_ctx).toBe(4096)
  })

  it("should detect hallucinations with invalid citations", () => {
    const grounder = new HallucinationGrounder()
    const response = "According to [5], the value is 42."

    const check = grounder.checkForHallucinations(response, 3) // Only 3 sources

    expect(check.passes).toBe(false)
    expect(check.issues.length).toBeGreaterThan(0)
    expect(check.issues[0].type).toBe("missing_source_id")
    expect(check.issues[0].severity).toBe("critical")
  })

  it("should pass verification when citations are valid", () => {
    const grounder = new HallucinationGrounder()
    const response = "According to [1], the value is 42. See also [2]."

    const check = grounder.checkForHallucinations(response, 2) // 2 sources provided

    // May have other issues, but not about missing source IDs
    const hasMissingSourceIssue = check.issues.some((i) => i.type === "missing_source_id")
    expect(hasMissingSourceIssue).toBe(false)
  })

  it("should detect speculative language without citations", () => {
    const grounder = new HallucinationGrounder()
    const response =
      "It seems like the value might be 42. According to my understanding, it probably refers to something. Perhaps we should consider that it may be related to context."

    const check = grounder.checkForHallucinations(response, 3)

    expect(check.passes).toBe(false)
    expect(check.issues.some((i) => i.type === "unsourced_claim")).toBe(true)
  })

  it("should update configuration at runtime", () => {
    const grounder = new HallucinationGrounder({ temperature: 0.3 })
    expect(grounder.getConfig().temperature).toBe(0.3)

    grounder.updateConfig({ temperature: 0.1 })
    expect(grounder.getConfig().temperature).toBe(0.1)
  })

  it("should handle multiple sources", () => {
    const grounder = new HallucinationGrounder()
    const sources = {
      "file1.txt": "Content 1",
      "file2.txt": "Content 2",
      "file3.txt": "Content 3",
    }

    const grounded = grounder.groundPrompt("Query", sources, "System")

    expect(grounded.sources.length).toBe(3)
    expect(grounded.sources[0].id).toBe(1)
    expect(grounded.sources[1].id).toBe(2)
    expect(grounded.sources[2].id).toBe(3)
  })
})
