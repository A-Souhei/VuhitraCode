import { describe, it, expect } from "bun:test"
import { SourceFormatter } from "../core/SourceFormatter"

describe("SourceFormatter", () => {
  it("should format sources with auto-numbered XML tags", () => {
    const sources = {
      "file.csv": "col1,col2\n10,20",
      "summary.txt": "Average is 15",
    }

    const { xml, metadata } = SourceFormatter.format(sources)

    expect(xml).toContain('<source id="1" name="file.csv">')
    expect(xml).toContain('<source id="2" name="summary.txt">')
    expect(metadata.length).toBe(2)
    expect(metadata[0].id).toBe(1)
    expect(metadata[0].name).toBe("file.csv")
    expect(metadata[1].id).toBe(2)
    expect(metadata[1].name).toBe("summary.txt")
  })

  it("should escape XML special characters", () => {
    const sources = {
      "test.txt": 'Value is <10 & >5, "quoted"',
    }

    const { xml } = SourceFormatter.format(sources)

    expect(xml).toContain("&lt;10")
    expect(xml).toContain("&gt;5")
    expect(xml).toContain("&quot;quoted&quot;")
    expect(xml).toContain("&amp;")
  })

  it("should extract citations from response", () => {
    const response = "According to [1], the value is 42. Reference [2] also confirms this."

    const citations = SourceFormatter.extractCitations(response)

    expect(citations).toEqual([1, 2])
  })

  it("should extract unique citations", () => {
    const response = "According to [1], see [2] and [1] again."

    const citations = SourceFormatter.extractCitations(response)

    expect(citations).toEqual([1, 2])
  })

  it("should handle text without citations", () => {
    const response = "This response has no citations."

    const citations = SourceFormatter.extractCitations(response)

    expect(citations).toEqual([])
  })

  it("should verify valid citations", () => {
    const response = "According to [1], and [2], the answer is clear."

    const check = SourceFormatter.verifyCitations(response, 2)

    expect(check.valid).toBe(true)
    expect(check.invalidCitations).toEqual([])
  })

  it("should reject citations to non-existent sources", () => {
    const response = "According to [1], see [5], but also [2]."

    const check = SourceFormatter.verifyCitations(response, 3) // Only 3 sources

    expect(check.valid).toBe(false)
    expect(check.invalidCitations).toEqual([5])
  })

  it("should reject zero or negative source IDs", () => {
    const response = "According to [0], see [-1], but also [1]."

    const check = SourceFormatter.verifyCitations(response, 2)

    expect(check.valid).toBe(false)
    // The regex pattern /\[(\d+)\]/ only matches positive integers
    // So -1 won't match. Only 0 and 1 will be extracted.
    expect(check.invalidCitations).toContain(0)
  })

  it("should handle empty sources", () => {
    const sources = {}

    const { xml, metadata } = SourceFormatter.format(sources)

    expect(xml).toBe("")
    expect(metadata).toEqual([])
  })

  it("should preserve source content exactly", () => {
    const content = "Exact\ncontent\nwith\nnewlines"
    const sources = { "file.txt": content }

    const { metadata } = SourceFormatter.format(sources)

    expect(metadata[0].content).toBe(content)
  })
})
