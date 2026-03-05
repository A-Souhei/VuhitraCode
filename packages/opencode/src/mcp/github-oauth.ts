import { McpOAuthProvider } from "./oauth-provider"

const GITHUB_MCP_CLIENT_ID = "Ov23li8tweQw6odWQebz"
const GITHUB_MCP_SCOPES = "repo read:user user:email read:org"

function isGitHubCopilotMcp(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "api.githubcopilot.com" || hostname.endsWith(".githubcopilot.com")
  } catch {
    return false
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

export { GITHUB_MCP_CLIENT_ID, GITHUB_MCP_SCOPES, isGitHubCopilotMcp }
