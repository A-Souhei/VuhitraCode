import { execSync } from "child_process"
import path from "path"
import fs from "fs"

const AUDIO_DIR = path.join(__dirname, "../../../../../../../packages/ui/src/assets/audio")

// Sound presets for different occasions
export const SOUNDS = {
  taskComplete: "alert-01.aac", // Task completion notification
  questionPrompt: "bip-bop-01.aac", // Question requires user input
} as const

type SoundType = keyof typeof SOUNDS

/**
 * Detect the current platform and return appropriate audio playback command
 */
function getPlatform(): "darwin" | "linux" | "win32" | "unknown" {
  return (process.platform as "darwin" | "linux" | "win32") || "unknown"
}

/**
 * Build platform-specific command to play audio file
 */
function getPlayCommand(filePath: string): { cmd: string; args: string[] } | null {
  const platform = getPlatform()

  if (platform === "darwin") {
    // macOS: use afplay
    return { cmd: "afplay", args: [filePath] }
  }

  if (platform === "linux") {
    // Linux: try paplay first, then ffplay
    try {
      execSync("which paplay", { stdio: "ignore" })
      return { cmd: "paplay", args: [filePath] }
    } catch {
      try {
        execSync("which ffplay", { stdio: "ignore" })
        return { cmd: "ffplay", args: ["-nodisp", "-autoexit", filePath] }
      } catch {
        // Fallback: try aplay
        return { cmd: "aplay", args: [filePath] }
      }
    }
  }

  if (platform === "win32") {
    // Windows: use PowerShell to play audio
    const escaped = filePath.replace(/\\/g, "\\\\")
    return {
      cmd: "powershell",
      args: ["-Command", `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`],
    }
  }

  return null
}

/**
 * Play a sound asynchronously with fallback to ASCII bell
 */
export async function playSound(type: SoundType = "taskComplete"): Promise<void> {
  try {
    const soundFile = SOUNDS[type]
    const filePath = path.join(AUDIO_DIR, soundFile)

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      // Fallback: just emit ASCII bell
      process.stdout.write("\x07")
      return
    }

    const playCmd = getPlayCommand(filePath)
    if (!playCmd) {
      // Fallback: just emit ASCII bell
      process.stdout.write("\x07")
      return
    }

    // Use Bun to spawn and wait for completion (with timeout to prevent hanging)
    const proc = Bun.spawn([playCmd.cmd, ...playCmd.args], {
      stdio: ["ignore", "ignore", "ignore"],
    })

    // Wait for completion with 5 second timeout
    const timeout = setTimeout(() => proc.kill(), 5000)

    try {
      await proc.exited
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    // Silently fail - don't interrupt the user experience
    try {
      process.stdout.write("\x07")
    } catch {
      // Even bell failed, just continue
    }
  }
}

/**
 * Check if notifications are enabled (reads from settings if available)
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    // Try to load settings from the project instance
    // This will return true by default if settings aren't found
    const { VuHitraSettings } = await import("@/project/vuhitra-settings")
    return VuHitraSettings.notificationsEnabled() ?? true
  } catch {
    // If we can't load settings, assume notifications are enabled
    return true
  }
}
