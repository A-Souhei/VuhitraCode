import { test, expect, mock, beforeEach } from "bun:test"

// Mock McpAuth before importing the module under test
const updateTokensMock = mock(() => Promise.resolve())
mock.module("../../src/mcp/auth", () => ({
  McpAuth: {
    updateTokens: updateTokensMock,
    getTokens: mock(() => Promise.resolve(null)),
  },
}))

// Mock Installation
mock.module("../../src/installation", () => ({
  Installation: {
    VERSION: "test",
    CHANNEL: "local",
    isLocal: () => false,
    isPreview: () => false,
    latest: async () => null,
  },
}))

// Mock oauth-provider (not needed in unit tests for pollDeviceFlow)
mock.module("../../src/mcp/oauth-provider", () => ({
  McpOAuthProvider: class {},
}))

import { pollDeviceFlow, isGitHubCopilotMcp, startDeviceFlow } from "../../src/mcp/github-oauth"

beforeEach(() => {
  updateTokensMock.mockClear()
})

// --- isGitHubCopilotMcp ---

test("isGitHubCopilotMcp matches api.githubcopilot.com", () => {
  expect(isGitHubCopilotMcp("https://api.githubcopilot.com/mcp")).toBe(true)
})

test("isGitHubCopilotMcp matches subdomains of githubcopilot.com", () => {
  expect(isGitHubCopilotMcp("https://foo.githubcopilot.com/v1")).toBe(true)
})

test("isGitHubCopilotMcp returns false for non-copilot urls", () => {
  expect(isGitHubCopilotMcp("https://api.github.com/mcp")).toBe(false)
})

test("isGitHubCopilotMcp returns false for invalid urls", () => {
  expect(isGitHubCopilotMcp("not-a-url")).toBe(false)
})

// --- pollDeviceFlow: deadline enforcement ---

test("deadline enforcement: throws when expiresIn is 0", async () => {
  // Replace Bun.sleep so the loop doesn't actually wait
  const orig = Bun.sleep
  ;(Bun as unknown as Record<string, unknown>).sleep = () => Promise.resolve()
  try {
    await expect(pollDeviceFlow("test-mcp", "dev-code", 5, 0, "https://example.com")).rejects.toThrow(
      "Device code expired",
    )
  } finally {
    ;(Bun as unknown as Record<string, unknown>).sleep = orig
  }
})

// --- pollDeviceFlow: access_denied terminates with error ---

test("access_denied terminates with error", async () => {
  const orig = Bun.sleep
  ;(Bun as unknown as Record<string, unknown>).sleep = () => Promise.resolve()

  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "access_denied" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  )
  const origFetch = global.fetch
  global.fetch = fetchMock as unknown as typeof fetch

  try {
    await expect(pollDeviceFlow("test-mcp", "dev-code", 1, 60, "https://example.com")).rejects.toThrow(
      "Device flow error: access_denied",
    )
  } finally {
    global.fetch = origFetch
    ;(Bun as unknown as Record<string, unknown>).sleep = orig
  }
})

// --- pollDeviceFlow: token storage on success ---

test("token storage on success: updateTokens called with correct data", async () => {
  const orig = Bun.sleep
  ;(Bun as unknown as Record<string, unknown>).sleep = () => Promise.resolve()

  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: "tok123",
          expires_in: 3600,
          refresh_token: "ref456",
          scope: "repo",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  )
  const origFetch = global.fetch
  global.fetch = fetchMock as unknown as typeof fetch

  try {
    await pollDeviceFlow("test-mcp", "dev-code", 1, 60, "https://example.com")
    expect(updateTokensMock).toHaveBeenCalledTimes(1)
    const call = (updateTokensMock.mock.calls as unknown[][])[0] as [
      string,
      { accessToken: string; refreshToken: string; scope: string; expiresAt: number },
      string,
    ]
    const [name, tokens, url] = call
    expect(name).toBe("test-mcp")
    expect(tokens.accessToken).toBe("tok123")
    expect(tokens.refreshToken).toBe("ref456")
    expect(tokens.scope).toBe("repo")
    expect(typeof tokens.expiresAt).toBe("number")
    expect(url).toBe("https://example.com")
  } finally {
    global.fetch = origFetch
    ;(Bun as unknown as Record<string, unknown>).sleep = orig
  }
})

// --- pollDeviceFlow: slow_down increases and maintains base interval ---

test("slow_down increases and maintains base interval", async () => {
  const sleepCalls: number[] = []
  const origSleep = Bun.sleep
  ;(Bun as unknown as Record<string, unknown>).sleep = (ms: number) => {
    sleepCalls.push(ms)
    return Promise.resolve()
  }

  // Sequence: slow_down (interval:10) -> authorization_pending -> access_token
  let call = 0
  const responses = [
    { error: "slow_down", interval: 10 },
    { error: "authorization_pending" },
    { access_token: "tok", scope: "repo" },
  ]
  const fetchMock = mock(() => {
    const data = responses[call++] ?? { error: "access_denied" }
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
  })
  const origFetch = global.fetch
  global.fetch = fetchMock as unknown as typeof fetch

  try {
    await pollDeviceFlow("test-mcp", "dev-code", 5, 120, "https://example.com")
    // After slow_down with interval:10 => base = 10*1000 + 3000 = 13000
    // sleep call 1: initial base (5*1000 + 3000 = 8000)
    // sleep call 2: new base after slow_down = 13000
    // sleep call 3: authorization_pending keeps wait = 13000
    expect(sleepCalls.length).toBe(3)
    expect(sleepCalls[0]).toBe(8000)
    // After slow_down the base increases to 13000
    expect(sleepCalls[1]).toBe(13000)
    // authorization_pending keeps wait = base = 13000
    expect(sleepCalls[2]).toBe(13000)
  } finally {
    global.fetch = origFetch
    ;(Bun as unknown as Record<string, unknown>).sleep = origSleep
  }
})
