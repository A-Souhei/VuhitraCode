import { execSync } from "child_process"

/**
 * Notification messages for different events
 */
export const NOTIFICATIONS = {
  taskComplete: {
    title: "Task Complete",
    message: "Your OpenCode task has finished",
    urgency: "normal",
  },
  questionPrompt: {
    title: "Question Required",
    message: "OpenCode is waiting for your input",
    urgency: "critical",
  },
} as const

type NotificationType = keyof typeof NOTIFICATIONS

/**
 * Detect the current platform
 */
function getPlatform(): "darwin" | "linux" | "win32" | "unknown" {
  return (process.platform as "darwin" | "linux" | "win32") || "unknown"
}

/**
 * Send notification using platform-specific method
 */
export async function notify(type: NotificationType = "taskComplete"): Promise<void> {
  try {
    const notification = NOTIFICATIONS[type]
    const platform = getPlatform()

    if (platform === "linux") {
      // Ubuntu/Linux: use notify-send
      try {
        await sendNotifyCommand(notification.title, notification.message, notification.urgency as any)
        return
      } catch {
        // Fallback to bell
        process.stdout.write("\x07")
      }
    } else if (platform === "darwin") {
      // macOS: use osascript
      try {
        await sendMacNotification(notification.title, notification.message)
        return
      } catch {
        // Fallback to bell
        process.stdout.write("\x07")
      }
    } else if (platform === "win32") {
      // Windows: use PowerShell
      try {
        await sendWindowsNotification(notification.title, notification.message)
        return
      } catch {
        // Fallback to bell
        process.stdout.write("\x07")
      }
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
 * Send notification using notify-send on Linux/Ubuntu
 */
async function sendNotifyCommand(
  title: string,
  message: string,
  urgency: "low" | "normal" | "critical",
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const proc = Bun.spawn(["notify-send", "-u", urgency, title, message], {
        stdio: ["ignore", "ignore", "ignore"],
      })

      const timeout = setTimeout(() => proc.kill(), 5000)
      proc.exited
        .then(() => {
          clearTimeout(timeout)
          resolve()
        })
        .catch((e) => {
          clearTimeout(timeout)
          reject(e)
        })
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Send notification using osascript on macOS
 */
async function sendMacNotification(title: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
      const proc = Bun.spawn(["osascript", "-e", script], {
        stdio: ["ignore", "ignore", "ignore"],
      })

      const timeout = setTimeout(() => proc.kill(), 5000)
      proc.exited
        .then(() => {
          clearTimeout(timeout)
          resolve()
        })
        .catch((e) => {
          clearTimeout(timeout)
          reject(e)
        })
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Send notification using PowerShell on Windows
 */
async function sendWindowsNotification(title: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null

$APP_ID = 'OpenCode'
$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">${title}</text>
            <text id="2">${message}</text>
        </binding>
    </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($APP_ID).Show($toast)
`
      const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
        stdio: ["ignore", "ignore", "ignore"],
      })

      const timeout = setTimeout(() => proc.kill(), 5000)
      proc.exited
        .then(() => {
          clearTimeout(timeout)
          resolve()
        })
        .catch((e) => {
          clearTimeout(timeout)
          reject(e)
        })
    } catch (e) {
      reject(e)
    }
  })
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
