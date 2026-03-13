export function authHeaders(http: { password?: string; username?: string } | undefined): Record<string, string> {
  if (!http?.password) return {}
  const auth = `${http.username ?? "opencode"}:${http.password}`
  const bytes = new TextEncoder().encode(auth)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return { Authorization: `Basic ${btoa(bin)}` }
}
