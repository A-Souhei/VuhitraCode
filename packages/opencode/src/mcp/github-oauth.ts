import { McpOAuthProvider } from "./oauth-provider"
import { McpAuth } from "./auth"
import { Installation } from "../installation"

// Public OAuth App client ID — not a secret; device flow requires no client secret.
const GITHUB_MCP_CLIENT_ID = "Ov23liLhzkn0xTnVG4W1"
const GITHUB_MCP_SCOPES = "repo read:user user:email read:org"
const POLLING_MARGIN_MS = 3000

function isGitHubCopilotMcp(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "api.githubcopilot.com" || hostname.endsWith(".githubcopilot.com")
  } catch {
    return false
  }
}

export type DeviceFlowStart = {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  deviceCode: string
  interval: number
  expiresIn: number
}

async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `opencode/${Installation.VERSION}`,
    },
    body: JSON.stringify({
      client_id: GITHUB_MCP_CLIENT_ID,
      scope: GITHUB_MCP_SCOPES,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Failed to start device flow: ${res.status} ${body}`)
  }
  const data = (await res.json()) as {
    verification_uri: string
    verification_uri_complete?: string
    user_code: string
    device_code: string
    interval: number
    expires_in: number
  }
  if (!data.device_code || !data.user_code || !data.verification_uri)
    throw new Error(`Unexpected response from GitHub device flow: ${JSON.stringify(data)}`)
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    deviceCode: data.device_code,
    interval: data.interval,
    expiresIn: data.expires_in,
  }
}

async function pollDeviceFlow(
  mcpName: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  serverUrl: string,
): Promise<void> {
  const deadline = Date.now() + expiresIn * 1000
  const base = interval * 1000 + POLLING_MARGIN_MS
  let wait = base
  while (true) {
    if (Date.now() >= deadline) throw new Error("Device code expired — please run auth again")
    await Bun.sleep(wait)
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": `opencode/${Installation.VERSION}`,
      },
      body: JSON.stringify({
        client_id: GITHUB_MCP_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Polling failed: ${res.status} ${body}`)
    }
    const data = (await res.json()) as {
      access_token?: string
      expires_in?: number
      refresh_token?: string
      scope?: string
      error?: string
      interval?: number
    }
    if (data.access_token) {
      await McpAuth.updateTokens(
        mcpName,
        {
          accessToken: data.access_token,
          ...(data.expires_in ? { expiresAt: Math.floor(Date.now() / 1000) + data.expires_in } : {}),
          ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
          scope: data.scope ?? GITHUB_MCP_SCOPES,
        },
        serverUrl,
      )
      return
    }
    if (data.error === "slow_down") {
      wait = (data.interval ? data.interval * 1000 : base + 5000) + POLLING_MARGIN_MS
      continue
    }
    if (data.error === "authorization_pending") {
      wait = base
      continue
    }
    if (data.error) throw new Error(`Device flow error: ${data.error}`)
  }
}

export class GitHubMcpOAuthProvider extends McpOAuthProvider {
  constructor(mcpName: string, serverUrl: string, onRedirect: (url: URL) => void | Promise<void>) {
    super(
      mcpName,
      serverUrl,
      {
        clientId: GITHUB_MCP_CLIENT_ID,
        scope: GITHUB_MCP_SCOPES,
      },
      {
        onRedirect,
      },
    )
  }
}

export { GITHUB_MCP_CLIENT_ID, GITHUB_MCP_SCOPES, isGitHubCopilotMcp, startDeviceFlow, pollDeviceFlow }
