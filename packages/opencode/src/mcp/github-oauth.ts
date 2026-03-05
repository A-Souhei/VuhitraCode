import { McpOAuthProvider } from "./oauth-provider"
import { McpAuth } from "./auth"
import { Installation } from "../installation"

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
  deviceCode: string
  interval: number
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
  if (!res.ok) throw new Error(`Failed to start device flow: ${res.status}`)
  const data = (await res.json()) as {
    verification_uri: string
    user_code: string
    device_code: string
    interval: number
  }
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    interval: data.interval,
  }
}

async function pollDeviceFlow(mcpName: string, deviceCode: string, interval: number, serverUrl: string): Promise<void> {
  let wait = interval * 1000 + POLLING_MARGIN_MS
  while (true) {
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
    if (!res.ok) throw new Error(`Polling failed: ${res.status}`)
    const data = (await res.json()) as {
      access_token?: string
      error?: string
      interval?: number
    }
    if (data.access_token) {
      await McpAuth.updateTokens(
        mcpName,
        {
          accessToken: data.access_token,
          scope: GITHUB_MCP_SCOPES,
        },
        serverUrl,
      )
      return
    }
    if (data.error === "slow_down") {
      const serverInterval = data.interval
      wait = (serverInterval && serverInterval > 0 ? serverInterval * 1000 : wait + 5000) + POLLING_MARGIN_MS
      continue
    }
    if (data.error === "authorization_pending") {
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
