using NAudio.CoreAudioApi;
using System.Diagnostics;
using System.Text.Json;
public static class DesktopTools
{
    public static readonly List<string> ToolNames =
    [
        "systemInfo",
        "openApplication",
        "openFolder",
        "openWebsite",
        "minimizeWindow",
        "maximizeWindow",
        "closeWindow",
        "switchApplication",
        "getClipboard",
        "setClipboard",
        "takeScreenshot",
        "volumeUp",
        "volumeDown",
        "setVolume",
        "muteToggle"
    ];

    public static bool TryExecute(string tool, JsonElement args, out object? result, out string error)
    {
        try
        {
            switch (tool)
            {
                case "systemInfo": result = SystemInfo(); error = ""; return true;
                case "openApplication": result = OpenApplication(GetArg(args, "name")); error = ""; return true;
                case "openFolder": result = OpenFolder(GetArg(args, "name")); error = ""; return true;
                case "openWebsite": result = OpenWebsite(GetArg(args, "url"), GetArg(args, "site")); error = ""; return true;
                case "volumeUp": result = VolumeUp(); error = ""; return true;
                case "volumeDown": result = VolumeDown(); error = ""; return true;
                case "setVolume": result = SetVolume(int.TryParse(GetArg(args, "percent"), out var pp) ? pp : GetArg(args, "value") is string v && int.TryParse(v, out var p2) ? p2 : 50); error = ""; return true;
                case "muteToggle": result = MuteToggle(); error = ""; return true;
                case "getClipboard": result = new { text = GetClipboard() }; error = ""; return true;
                case "setClipboard": SetClipboard(GetArg(args, "text")); result = new { ok = true }; error = ""; return true;
                case "takeScreenshot":
                    result = TakeScreenshot(); error = ""; return true;
                case "minimizeWindow":
                    result = MinimizeWindow(GetArg(args, "name")); error = ""; return true;
                case "maximizeWindow":
                    result = MaximizeWindow(GetArg(args, "name")); error = ""; return true;
                case "closeWindow":
                    result = CloseWindow(GetArg(args, "name")); error = ""; return true;
                case "switchApplication":
                    result = SwitchApplication(GetArg(args, "name")); error = ""; return true;
                default:
                    error = $"unknown tool: {tool}";
                    result = null;
                    return false;
            }
        }
        catch (Exception ex)
        {
            result = null;
            error = ex.Message;
            return false;
        }
    }

    private static string GetArg(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object) return "";
        if (args.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String)
            return el.GetString() ?? "";
        return "";
    }

    private static object SystemInfo()
    {
        var info = new
        {
            os = Environment.OSVersion.ToString(),
            machineName = Environment.MachineName,
            processorCount = Environment.ProcessorCount,
            availableMemoryBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes,
            drives = DriveInfo.GetDrives()
                .Where(d => d.IsReady)
                .Select(d => new { name = d.Name, freeBytes = d.AvailableFreeSpace, totalBytes = d.TotalSize })
                .ToList()
        };
        return info;
    }

    private static object OpenApplication(string name)
    {
        var known = name.ToLowerInvariant() switch
        {
            "" => "",
            "notepad" => "notepad.exe",
            "calculator" or "calc" => "calc.exe",
            "explorer" or "file explorer" => "explorer.exe",
            "task manager" => "taskmgr.exe",
            "settings" => "ms-settings:",
            _ => name
        };

        if (known == "ms-settings:")
        {
            Process.Start(new ProcessStartInfo("ms-settings:") { UseShellExecute = true });
            return new { ok = true, result = "Settings opened." };
        }

        Process.Start(new ProcessStartInfo(known) { UseShellExecute = true });
        return new { ok = true, result = $"{name} opened." };
    }

    private static object OpenFolder(string name)
    {
        var known = name.ToLowerInvariant() switch
        {
            "" or "desktop" => Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "downloads" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            "pictures" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            _ => name
        };
        Process.Start("explorer.exe", $"\"{known}\"");
        return new { ok = true, result = $"{known} opened." };
    }

    private static object OpenWebsite(string url, string site)
    {
        var target = !string.IsNullOrWhiteSpace(url) ? url
            : site.ToLowerInvariant() switch
            {
                "youtube" => "https://www.youtube.com",
                "github" => "https://github.com",
                "google" => "https://www.google.com",
                _ => $"https://www.google.com/search?q={Uri.EscapeDataString(site)}"
            };
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        return new { ok = true, result = $"{target} opened." };
    }

    private static string GetClipboard()
    {
        return Win32Native.GetClipboardText();
    }

    private static void SetClipboard(string text)
    {
        Win32Native.SetClipboardText(text);
    }


    private static object MinimizeWindow(string name)
    {
        var hwnd = Win32Native.FindWindowByTitle(name);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("window not found");
        Win32Native.ShowWindow(hwnd, Win32Native.SW_MINIMIZE);
        return new { ok = true, result = "minimized" };
    }

    private static object MaximizeWindow(string name)
    {
        var hwnd = Win32Native.FindWindowByTitle(name);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("window not found");
        Win32Native.ShowWindow(hwnd, Win32Native.SW_MAXIMIZE);
        return new { ok = true, result = "maximized" };
    }

    private static object CloseWindow(string name)
    {
        var hwnd = Win32Native.FindWindowByTitle(name);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("window not found");
        Win32Native.PostMessageW(hwnd, Win32Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        return new { ok = true, result = "close sent" };
    }

    private static object SwitchApplication(string name)
    {
        var hwnd = Win32Native.FindWindowByTitle(name);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("window not found");
        Win32Native.SetForegroundWindow(hwnd);
        return new { ok = true, result = "focused" };
    }

    private static object TakeScreenshot()
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "HasuScreenshots");
        var path = Win32Native.SaveScreenshot(folder);
        return new { ok = true, result = path, path };
    }

    private static object VolumeUp()
    {
        using var dev = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        dev.AudioEndpointVolume.MasterVolumeLevelScalar = Math.Min(1.0f, dev.AudioEndpointVolume.MasterVolumeLevelScalar + 0.1f);
        return new { ok = true, volume = (int)(dev.AudioEndpointVolume.MasterVolumeLevelScalar * 100) };
    }

    private static object VolumeDown()
    {
        using var dev = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        dev.AudioEndpointVolume.MasterVolumeLevelScalar = Math.Max(0.0f, dev.AudioEndpointVolume.MasterVolumeLevelScalar - 0.1f);
        return new { ok = true, volume = (int)(dev.AudioEndpointVolume.MasterVolumeLevelScalar * 100) };
    }

    private static object SetVolume(int percent)
    {
        using var dev = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        dev.AudioEndpointVolume.MasterVolumeLevelScalar = Math.Clamp(percent / 100f, 0f, 1f);
        return new { ok = true, volume = (int)(dev.AudioEndpointVolume.MasterVolumeLevelScalar * 100) };
    }

    private static object MuteToggle()
    {
        using var dev = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        dev.AudioEndpointVolume.Mute = !dev.AudioEndpointVolume.Mute;
        return new { ok = true, muted = dev.AudioEndpointVolume.Mute };
    }
    private static class Native
    {
        // Minimal placeholder; full Win32 clipboard P/Invoke arrives with Tier 1.
        public static bool TryGetClipboard(out string text)
        {
            text = "";
            return false;
        }

        public static void SetClipboard(string text) { }
    }
}

