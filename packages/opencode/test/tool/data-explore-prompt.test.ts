import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionPrompt } from "../../src/session/prompt"

describe("data-explore @file in prompt pipeline", () => {
  test("resolvePromptParts detects @file pattern in gitignored file", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "products.csv\n")
        await Bun.write(
          path.join(dir, "products.csv"),
          'id,name,category,price,stock\n1,Laptop Pro 15",Electronics,1299.99,50\n',
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompt = `Analyze @products.csv\n\nReport column names and row count.`
        const parts = await SessionPrompt.resolvePromptParts(prompt)
        console.error("[TEST] resolvePromptParts result:", JSON.stringify(parts, null, 2))
        // Should have a text part AND a file part
        const fileParts = parts.filter((p: any) => p.type === "file")
        const textParts = parts.filter((p: any) => p.type === "text")
        console.error("[TEST] file parts count:", fileParts.length)
        console.error("[TEST] text parts count:", textParts.length)
        expect(fileParts.length).toBe(1)
      },
    })
  })
})
