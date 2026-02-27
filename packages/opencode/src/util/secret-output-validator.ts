/**
 * Defense-in-depth validation layer to detect potential sensitive value leaks
 * from secret agent responses, even after faker pre-processing.
 *
 * This validator scans output for common secret patterns (API keys, DB URLs,
 * JWT tokens, AWS credentials, PII, etc.) and warns without blocking output.
 */

// Common secret prefixes and patterns
const PATTERNS = {
  // API keys: various vendor prefixes
  apiKeyPrefix:
    /\b(?:sk_|pk_|rk_|tok_|key-|ghp_|gho_|github_pat_|xoxb-|xoxp-|xoxa-|xoxs-|AKIA|ASIA)\w{12,}(?![a-zA-Z0-9_-])/g,
  // Bearer tokens: require minimum 20 chars and proper endpoints
  bearerToken: /\bbearer\s+([a-zA-Z0-9._\-=:]{20,})(?:\s|$|['\";,\)])/gi,
  // Database URLs with embedded credentials
  dbUrl: /\b(?:postgres(?:ql)?|mysql|mongodb|redis|mssql|amqp)(?:\+[\w]+)?:\/\/[^@\s]+:[^@\s]+@[^\s]+/gi,
  // JWT tokens: 3-part base64url pattern with minimum component lengths
  jwtToken: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/g,
  // AWS credentials: AKIA prefix for access keys
  awsAccessKey: /AKIA[0-9A-Z]{16}/g,
  // AWS secret access key pattern (common suffix)
  awsSecretKey: /aws_secret_access_key['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9\/+=]{40}['\"]?/gi,
  // Email addresses
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  // Phone numbers (basic pattern)
  phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  // IPv4 addresses (non-private ranges)
  ipAddress:
    /\b(?:(?:(?:1\d{2}|2[0-4]\d|25[0-5])\.)(?:(?:1\d{2}|2[0-4]\d|25[0-5])\.){2}(?:1\d{2}|2[0-4]\d|25[0-5])\b)/g,
  // Credit card patterns (basic)
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  // SSH private key markers
  sshPrivateKey: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY/gi,
  // PGP private key markers
  pgpPrivateKey: /-----BEGIN PGP PRIVATE KEY BLOCK-----/gi,
  // Hex strings in secret context only (not standalone hashes)
  hexSecret: /(?:secret|key|token|password|hash|encryption|signing)\s*[:=]\s*[0-9a-fA-F]{64}\b/gi,
  // Password-like patterns in code/config
  passwordAssignment:
    /(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth(?:entication|orization)?token|credential|access[_-]?(?:key|secret))['\"]?\s*[:=]\s*['\"]?([^'"\s;,}\]]+)/gi,
  // Environment variable exposure
  envVarExposure:
    /\b(?:password|passwd|secret|token|api[_\-.]?key|apikey|auth(?:entication|orization)?|credential|private[_\-.]?key|dsn|database[_\-.]?url|db[_\-.]?url|connection[_\-.]?string|access[_\-.]?(?:key|secret)|webhook[_\-.]?secret|signing[_\-.]?key|encryption[_\-.]?key|bearer|oauth|jwt|client[_\-.]?secret|app[_\-.]?secret|master[_\-.]?key|salt|passphrase|private[_\-.]?token|session[_\-.]?secret|stripe[_\-.]?(?:key|secret)|github[_\-.]?(?:token|key)|aws[_\-.]?(?:secret|access[_\-.]?key)|azure[_\-.]?(?:storage|key)|slack[_\-.]?(?:token|webhook))[=:]\S+/gi,
  // URL with credentials: protocol://user:password@host or protocol://token@host
  urlWithCredentials: /(?:https?|ftps?|ssh):\/\/[a-zA-Z0-9._%-]+(?::[^\s@]+)?@[a-zA-Z0-9.-]+(?::\d+)?(?:\/[^\s]*)?/gi,
  // Query parameters with secrets: api_key, token, secret, password in query strings
  queryParamSecret:
    /[?&](?:api[_-]?key|token|secret|password|access[_-]?token|bearer|auth[_-]?code)[=]([^\s&;,}"\]]+)/gi,
  // Authorization header with Bearer token: require minimum 20 chars
  authorizationHeader: /authorization\s*:\s*bearer\s+([a-zA-Z0-9._\-=:]{20,})(?:\s|$|['\";,\)])/gi,
} as const

export interface ValidationResult {
  isSafe: boolean
  warnings: string[]
  redactedOutput: string
}

/**
 * Validate secret agent output for potential sensitive value leaks.
 * Returns: safe flag, warning messages, optionally redacted output.
 * Non-destructive: warns rather than fails, continues processing.
 */
export function validateSecretAgentOutput(output: string, filepath?: string): ValidationResult {
  const warnings: string[] = []
  let redactedOutput = output

  // Scan for API key patterns
  const apiMatches = output.match(PATTERNS.apiKeyPrefix)
  if (apiMatches) {
    const realApiKeys = apiMatches.filter((m) => !isFakedValue(m))
    if (realApiKeys.length > 0) {
      warnings.push(`Potential API key pattern detected (${realApiKeys[0]})`)
    }
  }

  // Scan for bearer tokens
  const bearerMatches = output.match(PATTERNS.bearerToken)
  if (bearerMatches) {
    const realBearers = bearerMatches.filter((m) => {
      // Extract just the token part (after "bearer ")
      const token = m.replace(/^bearer\s+/i, "").trim()
      return !isFakedValue(token)
    })
    if (realBearers.length > 0) {
      warnings.push(`Potential bearer token pattern detected`)
    }
  }

  // Scan for database URLs with credentials
  const dbMatches = output.match(PATTERNS.dbUrl)
  if (dbMatches) {
    // Filter out URLs that have BOTH faked password AND faked domain
    // But warn if password looks real, even if domain is example.com
    const realDb = dbMatches.filter((m) => {
      // Extract password part (between : and @ in URL format)
      const passMatch = m.match(/\/\/[^:]+:([^@]+)@/)
      const password = passMatch ? passMatch[1] : ""

      const passwordIsFaked = isFakedValue(password)

      // Warn if password looks real (regardless of domain being fake)
      if (!passwordIsFaked) return true

      // Password is faked, so don't warn
      return false
    })
    if (realDb.length > 0) {
      warnings.push(`Potential database URL with credentials detected`)
    }
  }

  // Scan for JWT tokens
  const jwtMatches = Array.from(output.matchAll(PATTERNS.jwtToken))
  if (jwtMatches.length > 0) {
    const realJwts = jwtMatches.filter((m) => !isFakedValue(m[0]))
    if (realJwts.length > 0) {
      warnings.push(`Potential JWT token pattern detected`)
    }
  }

  // Scan for AWS access keys
  const awsAccessMatches = output.match(PATTERNS.awsAccessKey)
  if (awsAccessMatches) {
    warnings.push(`Potential AWS access key pattern detected (${awsAccessMatches[0]})`)
  }

  // Scan for AWS secret keys
  const awsSecretMatches = output.match(PATTERNS.awsSecretKey)
  if (awsSecretMatches) {
    warnings.push(`Potential AWS secret key pattern detected`)
  }

  // Scan for email addresses (more aggressive in validation)
  const emailMatches = output.match(PATTERNS.email)
  if (emailMatches && emailMatches.length > 0) {
    // Only warn if emails don't look like examples and not part of URLs
    const realEmails = emailMatches.filter((e) => !isExampleEmail(e) && !isEmailInUrl(e))
    if (realEmails.length > 0) {
      warnings.push(`Potential email addresses detected (${realEmails[0]})`)
    }
  }

  // Scan for phone numbers
  const phoneMatches = output.match(PATTERNS.phone)
  if (phoneMatches && phoneMatches.length > 0) {
    // Only warn if phone doesn't look like example
    const realPhones = phoneMatches.filter((p) => !isExamplePhone(p))
    if (realPhones.length > 0) {
      warnings.push(`Potential phone number pattern detected`)
    }
  }

  // Scan for SSH/PGP private key markers
  const sshMatches = output.match(PATTERNS.sshPrivateKey)
  if (sshMatches) {
    warnings.push(`SSH private key marker detected`)
  }

  const pgpMatches = output.match(PATTERNS.pgpPrivateKey)
  if (pgpMatches) {
    warnings.push(`PGP private key marker detected`)
  }

  // Scan for hex strings that look like secrets (256-bit hash minimum)
  // Only check hex in secret context (key=value with secret keywords)
  const hexMatches = output.match(PATTERNS.hexSecret)
  if (hexMatches && hexMatches.length > 0) {
    // Extract just the hex value (after = or :)
    const suspiciousHex = hexMatches.filter((m) => {
      const hexValue = m.split(/[:=]/).pop()?.trim() || ""
      return !isFakedValue(hexValue) && hexValue.length > 0
    })
    if (suspiciousHex.length > 0) {
      warnings.push(`Potential hex-encoded secret pattern detected`)
    }
  }

  // Scan for password/secret assignments
  const passwordMatches = output.match(PATTERNS.passwordAssignment)
  if (passwordMatches) {
    // Extract values and check if they're faked
    const realPasswords = passwordMatches.filter((m) => {
      const value = m.split(/[:=]/).pop()?.trim() || ""
      return !isFakedValue(value) && value.length > 0
    })
    if (realPasswords.length > 0) {
      warnings.push(`Potential secret assignment pattern detected`)
    }
  }

  // Scan for exposed environment variables
  const envMatches = output.match(PATTERNS.envVarExposure)
  if (envMatches) {
    // Extract values and check if they're faked
    const realEnv = envMatches.filter((m) => {
      const value = m.split("=")[1]?.trim() || ""
      return !isFakedValue(value) && value.length > 0
    })
    if (realEnv.length > 0) {
      warnings.push(`Potential environment variable exposure detected`)
    }
  }

  // Scan for URLs with embedded credentials (protocol://user:password@host)
  const urlMatches = output.match(PATTERNS.urlWithCredentials)
  if (urlMatches) {
    const realUrls = urlMatches.filter((url) => !isFakedUrl(url))
    if (realUrls.length > 0) {
      warnings.push(`Potential URL with embedded credentials detected`)
    }
  }

  // Scan for query parameters with secrets
  const queryMatches = output.match(PATTERNS.queryParamSecret)
  if (queryMatches) {
    const localDomains = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "example.com", "test.com", "demo.local"]
    const realParams = queryMatches.filter((param) => {
      // Skip if this is part of a local/example domain URL
      for (const domain of localDomains) {
        if (output.includes(domain)) {
          const domainIdx = output.lastIndexOf(domain)
          const paramIdx = output.indexOf(param)
          // Check if param is close to domain (same URL context)
          if (paramIdx > domainIdx && paramIdx < domainIdx + 100) {
            return false
          }
        }
      }
      return !isFakedValue(param)
    })
    if (realParams.length > 0) {
      warnings.push(`Potential secret in query parameter detected`)
    }
  }

  // Scan for Authorization headers with Bearer tokens
  const authMatches = output.match(PATTERNS.authorizationHeader)
  if (authMatches) {
    const realAuth = authMatches.filter((auth) => !isFakedValue(auth))
    if (realAuth.length > 0) {
      warnings.push(`Potential Authorization header with token detected`)
    }
  }

  // Add filepath context to warnings if provided
  if (warnings.length > 0 && filepath) {
    const contextedWarnings = warnings.map((w) => `[${filepath}] ${w}`)
    return {
      isSafe: false,
      warnings: contextedWarnings,
      redactedOutput,
    }
  }

  return {
    isSafe: warnings.length === 0,
    warnings,
    redactedOutput,
  }
}

/**
 * Check if a value looks like a faked/redacted value (from Faker).
 * Returns true if it appears to be already processed.
 */
function isFakedValue(value: string): boolean {
  if (!value) return true

  // Faker patterns that indicate already-faked content
  const fakerPatterns = [
    /^(?:example|fake|redacted|xxxx|hidden|masked|sanitized|placeholder)/i,
    /^[0x]+$/, // All zeros (like 0x0000...)
    /^(?:ZmFrZXZhbHVlcmVkYWN0ZWQ|ZmFrZQ)/, // Base64 encoded "fake" or "fakevalue"
    /^(?:postgres|postgresql|mysql|mongodb(?:\+[^:]*)?):\/\/user:fakepassword@localhost/, // Faked DB URLs with credentials
    /^(?:postgres|postgresql|mysql|mongodb)(?:\+[^:]*)?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/, // Faked DB URLs to localhost
    /^0+(?:\.|:|$)/, // All zeros
    /^(?:fakepassword|password)$/i, // Explicit fakepassword or generic "password"
    /^(?:fakepassword|fake_password)$/i, // Explicit fake password values
    /^fakeport$/i, // Explicit fake port
    /^fake_/i, // Only if starts with "fake_"
    /\buser@example\.com\b/i, // Example email
    /\+1-555-/, // Example phone (555 area code)
    /^00000000-0000-0000-0000-000000000000$/, // Faked UUID
    /eye(?:J|A).*(?:fake|example|redacted)/, // Faked JWT patterns (eye is base64 for "{")
    /fake_sig_redacted/i, // JWT with explicit fake signature
    /(?:example|placeholder)_?key|key_(?:example|placeholder)/i, // Example/placeholder keys
    /^(?:sk|pk|rk|ghp|xoxb|xoxa|xoxs|Bearer|basic|tok|key)[-_]?x{6,}/, // Vendor keys with x's (any amount)
    /^x{10,}$/, // All x's (common placeholder)
  ]

  for (const pattern of fakerPatterns) {
    if (pattern.test(value)) {
      return true
    }
  }

  return false
}

/**
 * Check if a URL looks like a faked/example URL (localhost, example.com, etc).
 * Returns true if it appears to be a test/fake URL.
 */
function isFakedUrl(url: string): boolean {
  if (!url) return true

  const fakePatterns = [
    /localhost/i,
    /127\.0\.0\.1/,
    /0\.0\.0\.0/,
    /example\.com/i,
    /example\.org/i,
    /test\.com/i,
    /fake\./i,
    /demo\./i,
    /fakepassword/i,
    /fake_/i,
    /test_/i,
    /placeholder/i,
    /user:fakepassword/i,
    /admin:fakepassword/i,
    /@localhost:/,
    /@127\.0\.0\.1:/,
    /:\w*xxx\w*@/i,
    /:\w*redacted\w*@/i,
  ]

  for (const pattern of fakePatterns) {
    if (pattern.test(url)) {
      return true
    }
  }

  return false
}

/**
 * Check if email looks like an example/test email.
 */
function isExampleEmail(email: string): boolean {
  const lowercased = email.toLowerCase()
  const examplePatterns = [/example\.com/, /test\./, /demo\./, /fake@/, /user@/, /admin@test/, /null@/, /\+\d+-555-/]

  for (const pattern of examplePatterns) {
    if (pattern.test(lowercased)) {
      return true
    }
  }

  return false
}

/**
 * Check if an email-like pattern is actually part of a URL (user:pass@host pattern).
 * Only return true if it looks like it's embedded in a URL context.
 */
function isEmailInUrl(email: string): boolean {
  // If it contains username:password pattern before @, it's likely a URL credential
  return /^[^@]*:[^@]+@(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?$/.test(email)
}

/**
 * Check if phone looks like an example/test phone.
 */
function isExamplePhone(phone: string): boolean {
  const patterns = [
    /555-01/, // Classic example pattern
    /000-0000/,
    /111-1111/,
    /123-4567/,
  ]

  for (const pattern of patterns) {
    if (pattern.test(phone)) {
      return true
    }
  }

  return false
}
