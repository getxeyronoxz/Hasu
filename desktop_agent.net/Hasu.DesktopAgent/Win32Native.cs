using System.Runtime.InteropServices;

internal static partial class Win32Native
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, char[] lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    public const int WM_CLOSE = 0x0010;
    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;

    public static IntPtr FindWindowByTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return GetForegroundWindow();
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var buffer = new char[256];
            if (GetWindowTextW(hwnd, buffer, buffer.Length) > 0)
            {
                var t = new string(buffer).TrimEnd('\0');
                if (t.Contains(title, StringComparison.OrdinalIgnoreCase))
                {
                    found = hwnd;
                    return false; // stop enumerating
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}


internal static partial class Win32Native
{
    public const uint CF_UNICODETEXT = 13;

    [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr hwndNewOwner);
    [DllImport("user32.dll")] public static extern bool CloseClipboard();
    [DllImport("user32.dll")] public static extern bool EmptyClipboard();
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint uFormat);
    [DllImport("user32.dll")] public static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
    [DllImport("kernel32.dll")] public static extern IntPtr GlobalAlloc(uint uFlags, nuint dwBytes);
    [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll")] public static extern nuint GlobalSize(IntPtr hMem);

    public static string GetClipboardText()
    {
        if (!OpenClipboard(IntPtr.Zero)) return "";
        try
        {
            var h = GetClipboardData(CF_UNICODETEXT);
            if (h == IntPtr.Zero) return "";
            var ptr = GlobalLock(h);
            if (ptr == IntPtr.Zero) return "";
            try { return Marshal.PtrToStringUni(ptr) ?? ""; }
            finally { GlobalUnlock(h); }
        }
        finally { CloseClipboard(); }
    }

    public static void SetClipboardText(string text)
    {
        if (!OpenClipboard(IntPtr.Zero)) return;
        try
        {
            EmptyClipboard();
            var h = GlobalAlloc(0x0042, (nuint)((text.Length + 1) * 2));
            var ptr = GlobalLock(h);
            try { Marshal.Copy(text.ToCharArray(), 0, ptr, text.Length); Marshal.WriteInt16(ptr, text.Length * 2, 0); }
            finally { GlobalUnlock(h); }
            SetClipboardData(CF_UNICODETEXT, h);
        }
        finally { CloseClipboard(); }
    }
}
