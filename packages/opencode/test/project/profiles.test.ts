import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { VuHitraSettings } from "../../src/project/vuhitra-settings"
import { Profiles } from "../../src/project/profiles"
import { Log } from "../../src/util/log"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import path from "path"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("activeProfile - deleted profile fallback", () => {
  test("falls back to default when active profile file is deleted", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create a custom profile
    await Profiles.create("test", tmp.path)

    // Set it as active
    await VuHitraSettings.setActiveProfile("test", tmp.path)
    expect(await VuHitraSettings.activeProfile(tmp.path)).toBe("test")

    // Delete the profile file
    const profilePath = path.join(profilesDir, "test.json")
    await fs.unlink(profilePath)

    // activeProfile should fall back to "default"
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")

    // Verify settings was updated to reflect default
    const settingsPath = path.join(tmp.path, ".vuhitra", "settings.json")
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
    expect(settings.active_profile).toBe("default")
  })

  test("falls back to default when active profile file becomes empty/corrupted", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create a valid profile with content
    await Profiles.create("valid", tmp.path)
    await Profiles.setAgentModel("valid", "test-agent", { providerID: "test", modelID: "model" }, tmp.path)

    // Set it as active
    await VuHitraSettings.setActiveProfile("valid", tmp.path)
    expect(await VuHitraSettings.activeProfile(tmp.path)).toBe("valid")

    // Overwrite the profile with empty content (simulating corruption)
    const profilePath = path.join(profilesDir, "valid.json")
    await fs.writeFile(profilePath, "{}")

    // activeProfile should detect empty content and fall back to default
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")
  })
})

describe("activeProfile - default profile auto-creation", () => {
  test("creates default.json when it doesn't exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")
    const defaultPath = path.join(profilesDir, "default.json")

    // Ensure no default.json exists
    try {
      await fs.unlink(defaultPath)
    } catch {
      // Doesn't exist, which is fine
    }

    // Call activeProfile
    const result = await VuHitraSettings.activeProfile(tmp.path)

    // Should return "default"
    expect(result).toBe("default")

    // Verify default.json was created
    const exists = await fs
      .access(defaultPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify file content is valid JSON
    const content = JSON.parse(await fs.readFile(defaultPath, "utf-8"))
    expect(content).toBeDefined()
  })
})

describe("activeProfile - both profiles deleted", () => {
  test("creates default when both active and default profiles are deleted", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create a custom profile and set it as active
    await Profiles.create("custom", tmp.path)
    await VuHitraSettings.setActiveProfile("custom", tmp.path)

    // Delete both profile files
    const customPath = path.join(profilesDir, "custom.json")
    const defaultPath = path.join(profilesDir, "default.json")

    try {
      await fs.unlink(customPath)
    } catch {
      // May not exist
    }
    try {
      await fs.unlink(defaultPath)
    } catch {
      // May not exist
    }

    // activeProfile should fall back to default and create it
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")

    // Verify default.json now exists
    const exists = await fs
      .access(defaultPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })
})

describe("setActiveProfile - validation", () => {
  test("throws error for non-existent profile", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(VuHitraSettings.setActiveProfile("non-existent-profile", tmp.path)).rejects.toThrow(
      "Profile not found: non-existent-profile",
    )
  })

  test("throws error for invalid profile name with special characters", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(VuHitraSettings.setActiveProfile("invalid/name", tmp.path)).rejects.toThrow(
      "Invalid profile name: invalid/name",
    )
  })

  test("throws error for invalid profile name with spaces", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(VuHitraSettings.setActiveProfile("invalid name", tmp.path)).rejects.toThrow(
      "Invalid profile name: invalid name",
    )
  })
})

describe("setActiveProfile - valid profile switch", () => {
  test("switches to existing profile", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a custom profile
    await Profiles.create("myprofile", tmp.path)

    // Switch to it
    await VuHitraSettings.setActiveProfile("myprofile", tmp.path)

    // Verify active profile
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("myprofile")
  })

  test("allows switching to default profile without explicit creation", async () => {
    await using tmp = await tmpdir({ git: true })

    // default should be allowed even if file doesn't exist yet
    await VuHitraSettings.setActiveProfile("default", tmp.path)

    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")
  })
})

describe("activeProfile - with explicit dir parameter", () => {
  test("works with explicit dir parameter for deleted active profile", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create and set a custom profile
    await Profiles.create("custom2", tmp.path)
    await VuHitraSettings.setActiveProfile("custom2", tmp.path)

    // Delete the profile file
    await fs.unlink(path.join(profilesDir, "custom2.json"))

    // Call with explicit dir
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")
  })

  test("creates default.json with explicit dir parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")
    const defaultPath = path.join(profilesDir, "default.json")

    // Ensure no profiles exist
    try {
      await fs.rm(profilesDir, { recursive: true })
    } catch {
      // May not exist
    }

    // Call with explicit dir
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")

    // Verify file exists
    const exists = await fs
      .access(defaultPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })
})

describe("Profiles - list function behavior", () => {
  test("always includes default in list even when file doesn't exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Ensure profiles directory is clean
    try {
      await fs.rm(profilesDir, { recursive: true })
    } catch {
      // May not exist
    }

    const profiles = await Profiles.list(tmp.path)

    // Default should always be available
    expect(profiles).toContain("default")
  })

  test("lists custom profiles along with default", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create custom profiles
    await Profiles.create("alpha", tmp.path)
    await Profiles.create("beta", tmp.path)

    const profiles = await Profiles.list(tmp.path)

    expect(profiles).toContain("default")
    expect(profiles).toContain("alpha")
    expect(profiles).toContain("beta")
  })
})

describe("activeProfile - settings persistence", () => {
  test("persists active_profile setting to disk", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create and set a custom profile
    await Profiles.create("persisted", tmp.path)
    await VuHitraSettings.setActiveProfile("persisted", tmp.path)

    // Verify settings file was written
    const settingsPath = path.join(tmp.path, ".vuhitra", "settings.json")
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
    expect(settings.active_profile).toBe("persisted")

    // Create a new VuHitraSettings context by reading from disk
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("persisted")
  })

  test("updates settings when falling back to default", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create and set a custom profile
    await Profiles.create("willbedeleted", tmp.path)
    await VuHitraSettings.setActiveProfile("willbedeleted", tmp.path)

    // Delete the profile file
    await fs.unlink(path.join(profilesDir, "willbedeleted.json"))

    // Call activeProfile - should fall back and update settings
    await VuHitraSettings.activeProfile(tmp.path)

    // Verify settings was updated
    const settingsPath = path.join(tmp.path, ".vuhitra", "settings.json")
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
    expect(settings.active_profile).toBe("default")
  })
})

describe("edge cases", () => {
  test("handles concurrent calls to activeProfile gracefully", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Ensure no default exists
    try {
      await fs.unlink(path.join(profilesDir, "default.json"))
    } catch {
      // May not exist
    }

    // Make multiple concurrent calls
    const results = await Promise.all([
      VuHitraSettings.activeProfile(tmp.path),
      VuHitraSettings.activeProfile(tmp.path),
      VuHitraSettings.activeProfile(tmp.path),
    ])

    // All should return "default"
    expect(results).toEqual(["default", "default", "default"])
  })

  test("setActiveProfile with 'default' works without prior creation", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Ensure no profiles exist
    try {
      await fs.rm(profilesDir, { recursive: true })
    } catch {
      // May not exist
    }

    // Setting to "default" should succeed
    await VuHitraSettings.setActiveProfile("default", tmp.path)

    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("default")
  })
})

// ============================================================================
// "no-profile" fallback behavior tests
// ============================================================================

describe("no-profile fallback - readProfile", () => {
  test("returns minimal profile object for 'no-profile' special name", async () => {
    const profile = await Profiles.readProfile("no-profile")

    // Should return the minimal fallback object
    expect(profile).toEqual({ agent_models: {}, subagent_models: {} })
  })

  test("does not create files when reading 'no-profile'", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Read no-profile
    const profile = await Profiles.readProfile("no-profile", tmp.path)

    // Verify the profile
    expect(profile).toEqual({ agent_models: {}, subagent_models: {} })

    // Verify no files were created in profiles directory
    let files: string[] = []
    try {
      files = await fs.readdir(profilesDir)
    } catch {
      // Directory doesn't exist, which is fine
    }

    // Should not have created any profile files
    const profileFiles = files.filter((f) => f.endsWith(".json"))
    expect(profileFiles.length).toBe(0)
  })

  test("returns 'no-profile' lookup without filesystem access", async () => {
    // Calling without a directory parameter should work
    // even if there's no valid project directory
    const profile = await Profiles.readProfile("no-profile")

    expect(profile).toEqual({ agent_models: {}, subagent_models: {} })
  })
})

describe("no-profile fallback - setActiveProfile", () => {
  test("throws error when trying to switch to 'no-profile'", async () => {
    await using tmp = await tmpdir({ git: true })

    // Attempt to switch to 'no-profile' should throw
    await expect(VuHitraSettings.setActiveProfile("no-profile", tmp.path)).rejects.toThrow(
      "Cannot switch to special profile 'no-profile'",
    )
  })

  test("error message includes the special profile name", async () => {
    await using tmp = await tmpdir({ git: true })

    try {
      await VuHitraSettings.setActiveProfile("no-profile", tmp.path)
      expect.unreachable("Should have thrown")
    } catch (err) {
      expect((err as Error).message).toContain("no-profile")
      expect((err as Error).message).toContain("Cannot switch")
    }
  })
})

describe("no-profile fallback - directory creation failure", () => {
  test("returns 'default' with fallback profile when .vuhitra/ cannot be created", async () => {
    await using tmp = await tmpdir({ git: true })
    const vuhitraDir = path.join(tmp.path, ".vuhitra")

    // Remove the .vuhitra directory if it exists
    try {
      await fs.rm(vuhitraDir, { recursive: true })
    } catch {
      // May not exist
    }

    // Create a file at .vuhitra path to block directory creation
    await fs.writeFile(vuhitraDir, "blocking file")

    // activeProfile should return "default" (not "no-profile") because readProfile
    // returns getNoProfile() which has valid keys, making exists=true
    const result = await VuHitraSettings.activeProfile(tmp.path)

    // Should return "default" - the fallback profile object is valid
    expect(result).toBe("default")

    // Clean up blocking file
    await fs.unlink(vuhitraDir)
  })

  test("returns 'no-profile' when non-existent profile is active and default cannot be created", async () => {
    await using tmp = await tmpdir({ git: true })
    const vuhitraDir = path.join(tmp.path, ".vuhitra")
    const settingsPath = path.join(vuhitraDir, "settings.json")

    // Create settings with a non-existent profile as active
    await fs.mkdir(vuhitraDir, { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ active_profile: "missing-profile" }))

    // Create a file to block .vuhitra/profiles directory creation
    const profilesDir = path.join(vuhitraDir, "profiles")
    await fs.writeFile(profilesDir, "blocking file")

    // activeProfile should try to find "missing-profile" (not found),
    // then try to fall back to "default" (can't create), and return "no-profile"
    const result = await VuHitraSettings.activeProfile(tmp.path)

    // Should return "no-profile" because:
    // 1. "missing-profile" doesn't exist (returns {})
    // 2. ensureDefault("default") fails (profiles is blocked by file)
    expect(result).toBe("no-profile")

    // Clean up
    await fs.unlink(profilesDir)
  })

  test("does not throw when profiles directory is inaccessible", async () => {
    await using tmp = await tmpdir({ git: true })
    const vuhitraDir = path.join(tmp.path, ".vuhitra")

    // Create a file at .vuhitra to make it inaccessible
    await fs.writeFile(vuhitraDir, "blocking file")

    // Should not throw, should return a valid profile name gracefully
    let result: string | undefined
    let error: Error | undefined

    try {
      result = await VuHitraSettings.activeProfile(tmp.path)
    } catch (err) {
      error = err as Error
    }

    // Clean up first so assert failures don't leave file behind
    await fs.unlink(vuhitraDir)

    // Verify behavior - should not throw
    expect(error).toBeUndefined()
    expect(result).toBe("default")
  })

  test("logs warning when falling back to no-profile profile", async () => {
    await using tmp = await tmpdir({ git: true })
    const vuhitraDir = path.join(tmp.path, ".vuhitra")

    // Block directory creation
    await fs.writeFile(vuhitraDir, "blocking file")

    // Spy on Log.Default.warn
    const warnSpy = spyOn(Log.Default, "warn")

    // Call activeProfile which should log a warning
    await VuHitraSettings.activeProfile(tmp.path)

    // Warning should be logged by readProfile's ensureDefault failure
    expect(warnSpy).toHaveBeenCalled()

    // Clean up
    await fs.unlink(vuhitraDir)
    warnSpy.mockRestore()
  })
})

describe("no-profile fallback - readProfile fallback", () => {
  test("returns getNoProfile() when .vuhitra/ cannot be created and default profile doesn't exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const vuhitraDir = path.join(tmp.path, ".vuhitra")

    // Block .vuhitra creation with a file
    await fs.writeFile(vuhitraDir, "blocking file")

    // Try to read "default" profile when it can't be created
    const profile = await Profiles.readProfile("default", tmp.path)

    // Should return the no-profile fallback object (has agent_models and subagent_models)
    expect(profile).toEqual({ agent_models: {}, subagent_models: {} })

    // Clean up
    await fs.unlink(vuhitraDir)
  })

  test("returns empty object when non-default profile doesn't exist", async () => {
    await using tmp = await tmpdir({ git: true })

    // Try to read a non-existent profile
    const profile = await Profiles.readProfile("non-existent-profile", tmp.path)

    // Should return empty object (not no-profile fallback)
    expect(profile).toEqual({})
  })

  test("returns getNoProfile() when profile file cannot be written", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".vuhitra", "profiles")

    // Create profiles directory
    await fs.mkdir(profilesDir, { recursive: true })

    // Create a directory where a profile file should be (blocks file creation)
    const profilePath = path.join(profilesDir, "default.json")
    await fs.mkdir(profilePath, { recursive: true })

    // Try to read the profile
    const profile = await Profiles.readProfile("default", tmp.path)

    // Should return the no-profile fallback object
    expect(profile).toEqual({ agent_models: {}, subagent_models: {} })

    // Clean up
    await fs.rm(profilePath, { recursive: true })
  })
})

describe("no-profile fallback - integration", () => {
  test("can use Profiles.readProfile('no-profile') alongside normal profiles", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a normal profile
    await Profiles.create("normal", tmp.path)
    await Profiles.setAgentModel("normal", "test-agent", { providerID: "test", modelID: "model" }, tmp.path)

    // Read normal profile
    const normalProfile = await Profiles.readProfile("normal", tmp.path)
    expect(normalProfile.agent_models?.["test-agent"]).toEqual({ providerID: "test", modelID: "model" })

    // Read no-profile
    const noProfile = await Profiles.readProfile("no-profile", tmp.path)
    expect(noProfile).toEqual({ agent_models: {}, subagent_models: {} })

    // Both should work independently
    expect(normalProfile).not.toEqual(noProfile)
  })

  test("activeProfile returns 'no-profile' when settings has 'no-profile' as active_profile", async () => {
    await using tmp = await tmpdir({ git: true })
    const settingsPath = path.join(tmp.path, ".vuhitra", "settings.json")

    // Manually set active_profile to "no-profile" in settings
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ active_profile: "no-profile" }))

    // activeProfile should return "no-profile" directly
    const result = await VuHitraSettings.activeProfile(tmp.path)
    expect(result).toBe("no-profile")
  })

  test("getNoProfile function returns consistent fallback object", () => {
    const fallback = Profiles.getNoProfile()

    expect(fallback).toEqual({ agent_models: {}, subagent_models: {} })

    // Calling again should return equivalent object
    const fallback2 = Profiles.getNoProfile()
    expect(fallback2).toEqual({ agent_models: {}, subagent_models: {} })
  })
})
