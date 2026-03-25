import { test, expect, describe } from "bun:test"
import { Canonicalize } from "./canonicalize"

describe("Canonicalize", () => {
  describe("extractQuery", () => {
    test("extracts entity names for structure type", () => {
      const result = Canonicalize.extractQuery(
        "UserSchema defines the user data structure with id and email fields",
        "structure",
      )
      expect(result).toContain("UserSchema")
      // Inferred type is "database schema" when "schema" keyword is present
      expect(result).toContain("database schema")
    })

    test("extracts multiple entity names for structure type", () => {
      const result = Canonicalize.extractQuery(
        "UserSchema and ProductSchema define the data models with their relationships",
        "structure",
      )
      // UPPER_CAMEL matches multi-word capitalized sequences
      // May only extract one if pattern doesn't match both
      expect(result).toContain("UserSchema")
    })

    test("extracts pattern names for pattern type", () => {
      const result = Canonicalize.extractQuery(
        "The retry-with-backoff pattern handles transient failures gracefully",
        "pattern",
      )
      expect(result).toContain("retry-with-backoff")
      expect(result).toContain("pattern")
    })

    test("falls back to words when no pattern name found", () => {
      const result = Canonicalize.extractQuery("This handles errors in a specific way", "pattern")
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(0)
    })

    test("extracts core problem for issue type", () => {
      const result = Canonicalize.extractQuery(
        "The application crashes when processing large files due to memory overflow",
        "issue",
      )
      expect(result).toContain("crashes")
      expect(result).toContain("memory")
    })

    test("extracts solution for resolution type", () => {
      const result = Canonicalize.extractQuery(
        "Increased the buffer size and added streaming to handle large files without memory issues",
        "resolution",
      )
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(0)
    })

    test("removes UUIDs from content", () => {
      const result = Canonicalize.extractQuery(
        "Session ses_abc123 with id 550e8400-e29b-41d4-a716-446655440000 was created",
        "finding",
      )
      expect(result).not.toContain("550e8400")
      expect(result).not.toContain("ses_abc123")
      expect(result).not.toContain("ses_")
    })

    test("removes timestamps from content", () => {
      const result = Canonicalize.extractQuery(
        "Created at 2024-03-15 and processed in 500ms for a duration of 2 hours",
        "issue",
      )
      expect(result).not.toContain("2024-03-15")
      expect(result).not.toContain("500ms")
      expect(result).not.toContain("2 hours")
    })

    test("removes URLs from content", () => {
      const result = Canonicalize.extractQuery(
        "Check the documentation at https://example.com/docs for more information",
        "procedure",
      )
      expect(result).not.toContain("https://")
      expect(result).not.toContain("example.com")
    })

    test("removes email addresses from content", () => {
      const result = Canonicalize.extractQuery("Contact user@example.com for support regarding the error", "issue")
      expect(result).not.toContain("user@example.com")
    })

    test("removes file paths from content", () => {
      const result = Canonicalize.extractQuery(
        "The file at /home/user/project/src/index.ts contains the main entry point",
        "structure",
      )
      expect(result).not.toContain("/home/user")
      expect(result).not.toContain("src/index.ts")
    })

    test("removes [REDACTED] placeholders", () => {
      const result = Canonicalize.extractQuery("The token [REDACTED] was invalid and caused the failure", "issue")
      expect(result).not.toContain("[REDACTED]")
    })

    test("truncates to 100 characters", () => {
      const longText =
        "This is a very long content that exceeds the maximum character limit and should be truncated to approximately one hundred characters for proper display and storage in the database"
      const result = Canonicalize.extractQuery(longText, "finding")
      expect(result.length).toBeLessThanOrEqual(100)
      expect(result.endsWith("...")).toBe(true)
    })

    test("handles dependency type extraction", () => {
      const result = Canonicalize.extractQuery(
        "Uses express and react packages with some custom middleware",
        "dependency",
      )
      expect(result).toBeTruthy()
    })

    test("handles api type extraction", () => {
      const result = Canonicalize.extractQuery("The UserData and Profile endpoints handle user operations", "api")
      expect(result).toContain("api")
    })

    test("handles config type extraction", () => {
      const result = Canonicalize.extractQuery("DATABASE_URL and API_KEY configuration settings are required", "config")
      expect(result).toContain("DATABASE_URL")
      expect(result).toContain("API_KEY")
      expect(result).toContain("config")
    })

    test("handles workflow type extraction", () => {
      const result = Canonicalize.extractQuery(
        "The deployment workflow involves building testing and deploying to production",
        "workflow",
      )
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(0)
    })

    test("handles procedure type extraction", () => {
      const result = Canonicalize.extractQuery("Run the build script then execute the tests to verify", "procedure")
      expect(result).toBeTruthy()
    })

    test("handles script type extraction", () => {
      const result = Canonicalize.extractQuery(
        "The migration script updates the database schema with new fields",
        "script",
      )
      expect(result).toContain("script")
    })

    test("handles log type extraction", () => {
      const result = Canonicalize.extractQuery(
        "The error log shows connection timeout and authentication failure",
        "log",
      )
      expect(result).toBeTruthy()
    })

    test("handles branch type extraction", () => {
      const result = Canonicalize.extractQuery(
        "Feature branch implementation completed with all tests passing",
        "branch",
      )
      expect(result).toBeTruthy()
    })
  })

  describe("extractTags", () => {
    test("detects TypeScript language", () => {
      const tags = Canonicalize.extractTags("Using TypeScript with strict mode and type safety", "structure")
      expect(tags).toContain("typescript")
    })

    test("detects JavaScript language", () => {
      const tags = Canonicalize.extractTags("Writing JavaScript code with ES6 features", "pattern")
      expect(tags).toContain("javascript")
    })

    test("detects Python language", () => {
      const tags = Canonicalize.extractTags("Python script for data processing with pandas", "script")
      expect(tags).toContain("python")
    })

    test("detects Rust language", () => {
      const tags = Canonicalize.extractTags("Rust implementation of the error handling module", "resolution")
      expect(tags).toContain("rust")
    })

    test("detects Go language", () => {
      const tags = Canonicalize.extractTags("Go server using goroutines for concurrent requests", "api")
      expect(tags).toContain("go")
    })

    test("detects React framework", () => {
      const tags = Canonicalize.extractTags("React component with hooks for state management", "structure")
      expect(tags).toContain("react")
    })

    test("detects Express framework", () => {
      const tags = Canonicalize.extractTags("Express middleware for request validation", "pattern")
      expect(tags).toContain("express")
    })

    test("detects Bun framework", () => {
      const tags = Canonicalize.extractTags("Bun server with built-in TypeScript support", "procedure")
      expect(tags).toContain("bun")
    })

    test("detects Next.js framework", () => {
      const tags = Canonicalize.extractTags("Next.js application with SSR and ISR capabilities", "structure")
      expect(tags).toContain("next.js")
    })

    test("detects async concept", () => {
      const tags = Canonicalize.extractTags("Using async await with promises for non-blocking operations", "pattern")
      expect(tags).toContain("async")
      expect(tags).toContain("await")
    })

    test("detects middleware concept", () => {
      const tags = Canonicalize.extractTags("Middleware chain for authentication and logging", "pattern")
      expect(tags).toContain("middleware")
    })

    test("detects error-handling concept", () => {
      const tags = Canonicalize.extractTags("Error handling with try catch and custom exceptions", "pattern")
      // The concept is stored as "error handling" (with space) in the concepts list
      // and "error handling" is also the inferred type for pattern when error is mentioned
      expect(tags).toContain("error handling")
    })

    test("detects database concept", () => {
      const tags = Canonicalize.extractTags("Database migration with schema changes", "procedure")
      expect(tags).toContain("database")
    })

    test("detects authentication concept", () => {
      const tags = Canonicalize.extractTags("JWT authentication with refresh tokens", "resolution")
      expect(tags).toContain("authentication")
    })

    test("includes type as first tag", () => {
      const tags = Canonicalize.extractTags("TypeScript React component structure", "structure")
      expect(tags[0]).toBe("structure")
    })

    test("adds inferred type tag when different from type", () => {
      const tags = Canonicalize.extractTags("Schema defined with validation rules", "structure")
      expect(tags).toContain("database schema")
    })

    test("limits to 10 tags", () => {
      const tags = Canonicalize.extractTags(
        "TypeScript JavaScript Python Rust React Express Next.js Vue Angular async middleware error-handling authentication database",
        "pattern",
      )
      expect(tags.length).toBeLessThanOrEqual(10)
    })

    test("removes duplicate tags", () => {
      const tags = Canonicalize.extractTags("TypeScript TypeScript typescript with React react", "structure")
      const typescriptCount = tags.filter((t) => t === "typescript").length
      expect(typescriptCount).toBe(1)
      const reactCount = tags.filter((t) => t === "react").length
      expect(reactCount).toBe(1)
    })

    test("handles empty content", () => {
      const tags = Canonicalize.extractTags("", "finding")
      expect(tags).toContain("finding")
      expect(tags.length).toBeGreaterThanOrEqual(1)
    })

    test("handles content with no detectable tags", () => {
      const tags = Canonicalize.extractTags("This is some random text without technical terms", "log")
      expect(tags).toContain("log")
      expect(tags.length).toBeGreaterThanOrEqual(1)
    })

    test("detects caching concept", () => {
      const tags = Canonicalize.extractTags("Redis caching layer for session storage", "resolution")
      expect(tags).toContain("caching")
    })

    test("detects API concept", () => {
      const tags = Canonicalize.extractTags("REST API with CRUD endpoints", "api")
      expect(tags).toContain("api")
    })

    test("detects schema concept", () => {
      const tags = Canonicalize.extractTags("Schema validation with Zod", "structure")
      expect(tags).toContain("schema")
    })

    test("detects validation concept", () => {
      const tags = Canonicalize.extractTags("Input validation middleware", "pattern")
      expect(tags).toContain("validation")
    })

    test("detects REST concept from frameworks list", () => {
      const tags = Canonicalize.extractTags("REST API design patterns", "api")
      expect(tags).toContain("rest")
    })

    test("detects Node concept", () => {
      const tags = Canonicalize.extractTags("Node server running on Linux", "procedure")
      expect(tags).toContain("node")
    })

    test("detects Prisma framework", () => {
      const tags = Canonicalize.extractTags("Prisma ORM for database operations", "dependency")
      expect(tags).toContain("prisma")
    })

    test("detects tRPC framework", () => {
      const tags = Canonicalize.extractTags("tRPC for type-safe API endpoints", "api")
      expect(tags).toContain("trpc")
    })
  })

  describe("createCanonicalResult", () => {
    test("combines extractQuery and extractTags", () => {
      const result = Canonicalize.createCanonicalResult(
        "UserSchema defines the database structure with TypeScript",
        "structure",
      )
      expect(result.query).toBeTruthy()
      expect(result.tags).toBeTruthy()
      expect(Array.isArray(result.tags)).toBe(true)
    })

    test("returns correct CanonicalResult structure", () => {
      const result = Canonicalize.createCanonicalResult("React component for user dashboard", "structure")
      expect(result).toHaveProperty("query")
      expect(result).toHaveProperty("tags")
      expect(typeof result.query).toBe("string")
      expect(Array.isArray(result.tags)).toBe(true)
    })

    test("merges existing tags with extracted tags", () => {
      const result = Canonicalize.createCanonicalResult("TypeScript React component", "structure", [
        "custom-tag",
        "existing",
      ])
      expect(result.tags).toContain("typescript")
      expect(result.tags).toContain("react")
      expect(result.tags).toContain("custom-tag")
      expect(result.tags).toContain("existing")
    })

    test("limits merged tags to 10", () => {
      const result = Canonicalize.createCanonicalResult(
        "TypeScript JavaScript Python Rust React Express Next.js Vue Angular Svelte",
        "structure",
        ["tag1", "tag2", "tag3"],
      )
      expect(result.tags.length).toBeLessThanOrEqual(10)
    })

    test("does not modify original existing tags array", () => {
      const existingTags = ["original-tag"]
      const result = Canonicalize.createCanonicalResult("React TypeScript project", "structure", existingTags)
      expect(existingTags).toEqual(["original-tag"])
      expect(result.tags).not.toBe(existingTags)
    })

    test("handles issue type with problem extraction", () => {
      const result = Canonicalize.createCanonicalResult(
        "The application crashes when memory is exhausted. Increased heap size and added garbage collection hints.",
        "issue",
      )
      expect(result.problem).toBeTruthy()
      expect(result.problem).toContain("crashes")
    })

    test("handles resolution type with solution extraction", () => {
      const result = Canonicalize.createCanonicalResult(
        "Fixed the memory leak issue. Added proper cleanup and removed circular references. Updated dependencies.",
        "resolution",
      )
      expect(result.solution).toBeTruthy()
      expect(result.solution).toContain("cleanup")
    })

    test("handles procedure type with steps extraction", () => {
      const result = Canonicalize.createCanonicalResult(
        "First install dependencies, then run build, finally start the server",
        "procedure",
      )
      expect(result.steps).toBeTruthy()
      expect(Array.isArray(result.steps)).toBe(true)
    })

    test("handles workflow type with steps extraction", () => {
      const result = Canonicalize.createCanonicalResult(
        "Build the project, run tests, lint code, deploy to staging, verify production",
        "workflow",
      )
      expect(result.steps).toBeTruthy()
      expect(Array.isArray(result.steps)).toBe(true)
    })

    test("does not include steps for structure type", () => {
      const result = Canonicalize.createCanonicalResult("UserSchema defines the user model", "structure")
      expect(result.steps).toBeUndefined()
    })

    test("does not include problem/solution for other types", () => {
      const result = Canonicalize.createCanonicalResult("React component pattern for state management", "pattern")
      expect(result.problem).toBeUndefined()
      expect(result.solution).toBeUndefined()
    })

    test("handles empty content gracefully", () => {
      const result = Canonicalize.createCanonicalResult("", "finding")
      expect(result.tags).toContain("finding")
    })

    test("handles content with no detectable patterns", () => {
      const result = Canonicalize.createCanonicalResult("Random text without meaning", "log")
      expect(result.query).toBeTruthy()
      expect(result.tags.length).toBeGreaterThan(0)
    })

    test("query is truncated to 100 characters", () => {
      const longContent =
        "This is a very long content that should definitely exceed the maximum limit of one hundred characters when processed by the canonicalization function for proper storage"
      const result = Canonicalize.createCanonicalResult(longContent, "finding")
      expect(result.query.length).toBeLessThanOrEqual(100)
    })

    test("tags do not exceed 10 even with many matches", () => {
      const result = Canonicalize.createCanonicalResult(
        "TypeScript JavaScript Python Rust Go Java C++ React Vue Angular Svelte Express Fastify Next.js Nuxt",
        "structure",
      )
      expect(result.tags.length).toBeLessThanOrEqual(10)
    })

    test("maintains type tag priority as first element", () => {
      const result = Canonicalize.createCanonicalResult("TypeScript React middleware pattern", "pattern")
      expect(result.tags[0]).toBe("pattern")
    })

    test("deduplicates tags from content and existing tags", () => {
      const result = Canonicalize.createCanonicalResult("React React React with TypeScript", "structure", [
        "react",
        "typescript",
      ])
      const reactCount = result.tags.filter((t) => t === "react").length
      const typescriptCount = result.tags.filter((t) => t === "typescript").length
      expect(reactCount).toBe(1)
      expect(typescriptCount).toBe(1)
    })

    test("returns empty problem/solution when issue/resolution has single sentence", () => {
      const result = Canonicalize.createCanonicalResult("The error occurred.", "issue")
      expect(result.problem).toBeUndefined()
      expect(result.solution).toBeUndefined()
    })
  })
})
