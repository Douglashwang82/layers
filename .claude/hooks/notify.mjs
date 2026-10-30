// Notification: show a Windows tray balloon when Claude is waiting on the user.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

if (process.platform !== "win32") process.exit(0);
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const message = String(input.message || "Claude Code needs your input")
  .replace(/'/g, "''")
  .slice(0, 200);

const ps = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(5000, 'Claude Code - LocalLink', '${message}', 'Info')
Start-Sleep -Seconds 6
$n.Dispose()`;

spawn(
  "powershell.exe",
  ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
  {
    detached: true,
    stdio: "ignore",
  },
).unref();
