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


internal static partial class Win32Native
{
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, uint rop);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr ho);
    [DllImport("gdi32.dll")] public static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint uStartScan, uint cScanLines, [Out] byte[]? lpvBits, ref BITMAPINFOHEADER lpbi, uint uUsage);

    private const uint SRCCOPY = 0x00CC0020;
    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    public static string SaveScreenshot(string directory)
    {
        Directory.CreateDirectory(directory);
        var width = GetSystemMetrics(SM_CXSCREEN);
        var height = GetSystemMetrics(SM_CYSCREEN);

        var hdcScreen = GetDC(IntPtr.Zero);
        var hdcMem = CreateCompatibleDC(hdcScreen);
        var hBmp = CreateCompatibleBitmap(hdcScreen, width, height);
        var hOld = SelectObject(hdcMem, hBmp);
        BitBlt(hdcMem, 0, 0, width, height, hdcScreen, 0, 0, SRCCOPY);

        var info = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = width,
            biHeight = -height,
            biPlanes = 1,
            biBitCount = 24,
            biCompression = 0
        };
        int stride = (width * 3 + 3) & ~3;
        var bits = new byte[stride * height];
        GetDIBits(hdcMem, hBmp, 0, (uint)height, bits, ref info, 0);

        SelectObject(hdcMem, hOld);
        DeleteObject(hBmp);
        DeleteDC(hdcMem);
        ReleaseDC(IntPtr.Zero, hdcScreen);

        var path = Path.Combine(directory, $"hasu_{DateTime.Now:yyyyMMdd_HHmmss}.bmp");
        using var fs = new FileStream(path, FileMode.Create);
        using var w = new BinaryWriter(fs);
        // BITMAPFILEHEADER (14 bytes)
        w.Write((ushort)0x4D42); // 'BM'
        w.Write((uint)(14 + 40 + bits.Length));
        w.Write((ushort)0);
        w.Write((ushort)0);
        w.Write((uint)(14 + 40));
        // BITMAPINFOHEADER
        w.Write(info.biSize);
        w.Write(info.biWidth);
        w.Write(info.biHeight);
        w.Write(info.biPlanes);
        w.Write(info.biBitCount);
        w.Write(info.biCompression);
        w.Write((uint)bits.Length);
        w.Write(info.biXPelsPerMeter);
        w.Write(info.biYPelsPerMeter);
        w.Write(info.biClrUsed);
        w.Write(info.biClrImportant);
        w.Write(bits);
        return path;
    }
}
