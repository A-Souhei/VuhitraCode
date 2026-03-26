import { test, expect, mock, beforeEach } from "bun:test"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit }
}> = []

// Mock the transport constructors to capture their arguments
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

beforeEach(() => {
  transportCalls.length = 0
})

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

// The root opencode.json may include extra MCP servers (e.g. context7) without headers.
// Filter to only the calls for the server we explicitly add so assertions are precise.
function callsForUrl(url: string) {
  return transportCalls.filter((c) => c.url === url)
}

test("headers are passed to transports when oauth is enabled (default)", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("test-server", {
        type: "remote",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      }).catch(() => {})

      const calls = callsForUrl("https://example.com/mcp")
      expect(calls.length).toBeGreaterThanOrEqual(1)

      for (const call of calls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        })
        expect(call.options.authProvider).toBeDefined()
      }
    },
  })
})

test("headers are passed to transports when oauth is explicitly disabled", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-oauth", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
        headers: {
          Authorization: "Bearer test-token",
        },
      }).catch(() => {})

      const calls = callsForUrl("https://example.com/mcp")
      expect(calls.length).toBeGreaterThanOrEqual(1)

      for (const call of calls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
        })
        expect(call.options.authProvider).toBeUndefined()
      }
    },
  })
})

test("no requestInit when headers are not provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-headers", {
        type: "remote",
        url: "https://example.com/mcp",
      }).catch(() => {})

      const calls = callsForUrl("https://example.com/mcp")
      expect(calls.length).toBeGreaterThanOrEqual(1)

      for (const call of calls) {
        expect(call.options.requestInit).toBeUndefined()
      }
    },
  })
})
