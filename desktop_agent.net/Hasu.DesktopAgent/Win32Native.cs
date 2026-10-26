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
