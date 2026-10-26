"""Media keys and Windows toast notifications.

Media control uses synthetic VK media key presses (works regardless of which
app is playing). Notifications use the built-in Windows.UI.Notifications
WinRT API via PowerShell so task completions and reminders can surface even
when the voice channel is closed.
"""

from __future__ import annotations

import platform
import subprocess
import time
import xml.sax.saxutils as saxutils
from typing import Any, Dict

from .registry import ToolError, register

VK_MEDIA_NEXT = 0xB0
VK_MEDIA_PREV = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
KEYEVENTF_KEYUP = 0x0002

_MEDIA_ACTIONS = {
    "play_pause": (VK_MEDIA_PLAY_PAUSE, "Play/pause toggled."),
    "play": (VK_MEDIA_PLAY_PAUSE, "Play toggled."),
    "pause": (VK_MEDIA_PLAY_PAUSE, "Pause toggled."),
    "next": (VK_MEDIA_NEXT, "Skipped to the next track."),
    "previous": (VK_MEDIA_PREV, "Went back to the previous track."),
    "stop": (VK_MEDIA_STOP, "Stopped playback."),
}

_PY_AUTO_KEYS = {
    "play_pause": "playpause",
    "play": "playpause",
    "pause": "playpause",
    "next": "nexttrack",
    "previous": "prevtrack",
    "stop": "stop",
}


def _press_media_vk(vk: int, action: str) -> None:
    if platform.system() == "Windows":
        try:
            import ctypes

            ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
            return
        except Exception:
            pass
    try:
        import pyautogui

        pyautogui.press(_PY_AUTO_KEYS[action])
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not send the media key: {e}")


@register("mediaControl")
def media_control(args: Dict[str, Any]) -> Dict[str, Any]:
    """Press a system media key. Args: action play_pause|play|pause|next|previous|stop."""
    action = str(args.get("action") or "play_pause").lower()
    if action not in _MEDIA_ACTIONS:
        raise ToolError(f"Unknown media action '{action}'. Use play_pause, next, previous or stop.")
    vk, message = _MEDIA_ACTIONS[action]
    _press_media_vk(vk, action)
    return {"result": message}


_TOAST_PS = r"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = @"
<toast><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual></toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("{appid}").Show($toast)
"""


@register("showNotification")
def show_notification(args: Dict[str, Any]) -> Dict[str, Any]:
    """Show a Windows toast notification. Args: title, body (both short plain text)."""
    if platform.system() != "Windows":
        raise ToolError("Notifications are only supported on Windows.")
    title = saxutils.escape(str(args.get("title") or "Hasu")[:120])
    body = saxutils.escape(str(args.get("body") or "")[:280])
    if not body:
        raise ToolError("A notification body is required.")
    script = _TOAST_PS.replace("{title}", title).replace("{body}", body).replace("{appid}", "Hasu")
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not show the notification: {e}")
    if proc.returncode != 0:
        raise ToolError(f"Notification failed: {(proc.stderr or proc.stdout).strip()[:200]}")
    return {"result": f"Notification shown: {title}."}


__all__ = ["media_control", "show_notification"]
