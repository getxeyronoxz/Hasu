"""Phone control: bring Windows Phone Link to the foreground and, when an
Android device is attached over USB, answer / hang up / decline calls via
ADB keyevents. Falls back gracefully when ADB or Phone Link is unavailable.
"""

from __future__ import annotations

import platform
import subprocess
import time
from typing import Any, Dict

from .registry import ToolError, register

ADB_TIMEOUT = 8


def _adb_devices() -> list[str]:
    if platform.system() != "Windows":
        return []
    try:
        out = subprocess.run(
            ["adb", "devices"],
            capture_output=True, text=True, timeout=ADB_TIMEOUT,
        ).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    devices: list[str] = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def _adb(serial: str, *args: str) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            ["adb", "-s", serial, *args],
            capture_output=True, text=True, timeout=ADB_TIMEOUT,
        )
        return proc.returncode, (proc.stdout or proc.stderr).strip()
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


@register("answerCall")
def answer_call(args: Dict[str, Any]) -> Dict[str, Any]:
    """Answer an incoming phone call. Focuses Phone Link (Windows) and, if a
    phone is attached over USB, sends the answer keyevent (KEYCODE_CALL)."""
    results: list[str] = []
    # 1. Focus Phone Link so the user can see / hear the call even if ADB
    #    cannot auto-answer (most phones block ADB call control).
    try:
        import win32gui

        hwnd = None
        def cb(h, _):
            nonlocal hwnd
            if win32gui.IsWindowVisible(h):
                title = win32gui.GetWindowText(h)
                if "phone link" in title.lower() or "your phone" in title.lower():
                    hwnd = h
            return True
        win32gui.EnumWindows(cb, None)
        if hwnd:
            try:
                win32gui.ShowWindow(hwnd, 9)  # SW_RESTORE
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass
            results.append("Phone Link brought to the foreground.")
    except Exception:
        pass

    # 2. ADB auto-answer on attached Android devices.
    devices = _adb_devices()
    answered = 0
    for serial in devices:
        rc, _ = _adb(serial, "shell", "input", "keyevent", "5")  # KEYCODE_CALL
        if rc == 0:
            answered += 1
    if devices:
        if answered:
            results.append(f"Sent answer keyevent to {answered}/{len(devices)} attached phone(s).")
        else:
            results.append(f"ADB could not answer on {len(devices)} phone(s) (most phones block this).")
    else:
        results.append("No Android phone attached over USB for hands-free answer.")

    if not results:
        raise ToolError("Could not reach Phone Link or ADB.")
    return {"result": " ".join(results)}


@register("hangUpCall")
def hang_up_call(args: Dict[str, Any]) -> Dict[str, Any]:
    """End the current call. Sends KEYCODE_ENDCALL to attached phones."""
    devices = _adb_devices()
    if not devices:
        raise ToolError("No Android phone attached over USB.")
    hung = 0
    for serial in devices:
        rc, _ = _adb(serial, "shell", "input", "keyevent", "6")  # KEYCODE_ENDCALL
        if rc == 0:
            hung += 1
    return {"result": f"Sent hang-up keyevent to {hung}/{len(devices)} phone(s)."}


@register("declineCall")
def decline_call(args: Dict[str, Any]) -> Dict[str, Any]:
    """Decline an incoming call on attached phones (KEYCODE_ENDCALL)."""
    return hang_up_call(args)


@register("listPhones")
def list_phones(args: Dict[str, Any]) -> Dict[str, Any]:
    """List Android devices currently attached over USB/ADB."""
    devices = _adb_devices()
    if not devices:
        return {"result": "No Android phones attached over USB."}
    info = []
    for serial in devices:
        rc, model = _adb(serial, "shell", "getprop", "ro.product.model")
        info.append({"serial": serial, "model": model if rc == 0 and model else "unknown"})
    return {"result": f"{len(devices)} phone(s) attached.", "devices": info}


__all__ = ["answer_call", "hang_up_call", "decline_call", "list_phones"]
