import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("data-explore gitignore exemption", () => {
  test("data-explore agent can read gitignored CSV file", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "products.csv\n")
        await Bun.write(
          path.join(dir, "products.csv"),
          'id,name,category,price,stock\n1,Laptop Pro 15",Electronics,1299.99,50\n2,ErgoMax Office Chair,Furniture,249.50,100\n',
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const ctx = {
          sessionID: "test",
          messageID: "",
          callID: "",
          agent: "data-explore",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }
        // This should NOT throw - data-explore is exempt from gitignore
        const result = await read.execute({ filePath: path.join(tmp.path, "products.csv") }, ctx)
        console.error("[TEST] result.output:", result.output)
        expect(result.output).toContain("id,name,category,price,stock")
        expect(result.output).toContain("Laptop Pro 15")
      },
    })
  })
})
