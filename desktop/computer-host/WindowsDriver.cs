using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Sbroenne.WindowsMcp.Models;
using Sbroenne.WindowsMcp.Tools;

namespace UnrealCode.ComputerHost;

internal sealed class WindowsDriver
{
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(NativePoint point);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out int value, int size);
    private readonly string generation = Guid.NewGuid().ToString();
    private readonly int parent;
    private readonly string parentPath;
    private readonly Dictionary<string, Surface> surfaces = [];
    private readonly Dictionary<string, (Observation Value, string Lease, long Epoch)> observations = [];
    private static readonly HashSet<string> excluded = new(StringComparer.OrdinalIgnoreCase) { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "iexplore", "msedgewebview2", "cmd", "powershell", "pwsh", "windowsterminal", "regedit", "taskmgr", "mmc", "consent", "credentialuibroker", "logonui", "1password", "bitwarden", "keepass", "keepassxc", "dashlane", "systemsettings", "securityhealthsystray", "sechealthui" };
    private static readonly Regex credential = new(@"password|passcode|api\s*key|secret|access\s*token|كلمة\s*المرور", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    public NativeAuthority Authority { get; }
    public string Generation => generation;
    public bool Elevated => new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    public bool DesktopReady => !Elevated && !WindowsToolsBase.SecureDesktopDetector.IsSecureDesktopActive() && Desktop().Length > 0;
    public WindowsDriver(int parent) { this.parent = parent; parentPath = Process.GetProcessById(parent).MainModule?.FileName ?? ""; Authority = new(Validate); }
    private static string Desktop()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops");
        if (key?.GetValue("CurrentVirtualDesktop") is byte[] value) return Convert.ToHexString(value);
        using var session = Registry.CurrentUser.OpenSubKey($@"Software\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo\{Process.GetCurrentProcess().SessionId}\VirtualDesktops");
        return session?.GetValue("CurrentVirtualDesktop") is byte[] current ? Convert.ToHexString(current) : "";
    }
    private bool Validate(Surface window, bool foreground)
    {
        try
        {
            var hwnd = nint.Parse(window.Handle, CultureInfo.InvariantCulture);
            GetWindowThreadProcessId(hwnd, out var pid);
            if (!DesktopReady || window.Desktop != Desktop() || !IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd) || pid != window.ProcessId) return false;
            using var process = Process.GetProcessById((int)pid);
            if (process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) != window.Started || process.SessionId != Process.GetCurrentProcess().SessionId) return false;
            if (DwmGetWindowAttribute(hwnd, 14, out var cloaked, sizeof(int)) != 0 || cloaked != 0) return false;
            if (foreground && (GetForegroundWindow() != hwnd || GetDpiForWindow(hwnd) != window.Dpi || !GetWindowRect(hwnd, out var rect) || rect.Left != window.Bounds.X || rect.Top != window.Bounds.Y || rect.Right - rect.Left != window.Bounds.Width || rect.Bottom - rect.Top != window.Bounds.Height)) return false;
            return true;
        }
        catch { return false; }
    }
    public async Task<IReadOnlyList<Surface>> Windows(CancellationToken token)
    {
        if (!DesktopReady) throw new ComputerError("DESKTOP_UNAVAILABLE", "Use an unlocked desktop and start UnrealCode without administrator privileges. Desktop monitoring must be available.");
        var list = await WindowsToolsBase.WindowService.ListWindowsAsync(cancellationToken: token);
        if (!list.Success) throw new ComputerError("WINDOW_LIST_FAILED", "Windows could not enumerate visible applications.");
        var result = new List<Surface>();
        foreach (var item in (list.Windows ?? []).Take(128))
        {
            token.ThrowIfCancellationRequested();
            try
            {
                var window = await WindowsToolsBase.WindowService.GetWindowInfoAsync(nint.Parse(item.Handle), token);
                if (window is null) continue;
                using var process = Process.GetProcessById(window.ProcessId);
                var started = process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture);
                var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{generation}:{window.Handle}:{window.ProcessId}:{started}")))[..32].ToLowerInvariant();
                string? blocked = !window.OnCurrentDesktop ? "Switch to this window’s desktop first." : window.IsElevated ? "Administrator windows require user takeover." : !window.IsResponding ? "This application is not responding." : null;
                if (window.ProcessId == parent || window.ProcessId == Environment.ProcessId || string.Equals(process.MainModule?.FileName, parentPath, StringComparison.OrdinalIgnoreCase)) blocked = "Use UnrealCode’s own controls yourself; the agent cannot manage its grants.";
                if (excluded.Contains(Path.GetFileNameWithoutExtension(window.ProcessName))) blocked = "Use the shared browser or the existing approved tools for this application.";
                var surface = new Surface(id, window.Handle, window.ProcessId, started, window.Title[..Math.Min(window.Title.Length, 256)], window.ProcessName, CaptureBounds(window.Handle), GetDpiForWindow(nint.Parse(window.Handle)), Desktop(), blocked);
                surfaces[id] = surface; result.Add(surface);
            }
            catch (OperationCanceledException) { throw; }
            catch { /* A closing or inaccessible window is not a control target. */ }
        }
        return result;
    }
    private static WindowBounds CaptureBounds(string handle) {
        if (!GetWindowRect(nint.Parse(handle), out var rect) || rect.Right <= rect.Left || rect.Bottom <= rect.Top) throw new ComputerError("WINDOW_GEOMETRY", "The selected window has no usable capture area.");
        // PrintWindow captures GetWindowRect, including the invisible resize frame.
        // DWM visible-frame bounds would shift clicks and fail freshness checks.
        return new WindowBounds { X = rect.Left, Y = rect.Top, Width = rect.Right - rect.Left, Height = rect.Bottom - rect.Top };
    }
    public Surface Window(string id) => surfaces.TryGetValue(id, out var value) && Validate(value, false) ? value : throw new ComputerError("WINDOW_CHANGED", "Refresh the window list; this window is no longer available.");
    public void ClearObservations() => observations.Clear();
    public void CheckEnvironment() { var lease = Authority.Current; if (lease is not null && (!DesktopReady || lease.Windows.Values.Any(w => !Validate(w, false)))) Authority.Stop("Desktop or window identity changed. Review access again."); }
    private static IEnumerable<UIElementInfo> Flatten(IEnumerable<UIElementInfo> elements)
    {
        foreach (var element in elements) { yield return element; foreach (var child in Flatten(element.Children ?? [])) yield return child; }
    }
    internal static BoundingRect[] CredentialMasks(IEnumerable<ObservedElement> elements) => elements.Where(element => element.Password).Select(element => element.Bounds).ToArray();
    internal static void CheckCapture(WindowBounds bounds, string? parentElement)
    {
        if (!string.IsNullOrEmpty(parentElement)) throw new ComputerError("CAPTURE_SCOPE", "For a window screenshot, observe the whole window so credential masks can be collected. Scoped accessibility observations remain available without an image.");
        if (bounds.Width <= 0 || bounds.Height <= 0 || bounds.Width > 16384 || bounds.Height > 16384 || (long)bounds.Width * bounds.Height > 32L * 1024 * 1024) throw new ComputerError("CAPTURE_TOO_LARGE", "Resize the selected window before capturing a bounded image.");
    }
    public async Task<Observation> Observe(string lease, string windowId, string? parentElement, bool image, bool local, CancellationToken token)
    {
        var window = Window(windowId);
        var info = await WindowsToolsBase.WindowService.GetWindowInfoAsync(nint.Parse(window.Handle), token);
        if (info is null) throw new ComputerError("WINDOW_CHANGED", "The selected window closed.");
        window = window with { Bounds = CaptureBounds(window.Handle), Dpi = GetDpiForWindow(nint.Parse(window.Handle)) };
        if (image) CheckCapture(window.Bounds, parentElement);
        using var scope = Authority.Begin(lease, window, false, local, token);
        var result = await WindowsToolsBase.UIAutomationService.GetTreeAsync(window.Handle, parentElement, 8, null, scope.Token);
        if (!result.Success) throw new ComputerError("OBSERVATION_FAILED", result.ErrorMessage ?? "This application did not expose a readable accessibility tree.");
        var visibleElements = Flatten(result.FullTree ?? result.Elements ?? []).Where(e => !e.IsOffscreen && e.BoundingRect.Width > 0 && e.BoundingRect.Height > 0).Select(e => new ObservedElement(e.ElementId, e.IsPassword || credential.IsMatch(e.Name ?? "") ? "[credential field]" : (e.Name ?? "")[..Math.Min(e.Name?.Length ?? 0, 500)], e.ControlType, e.IsEnabled, e.BoundingRect, e.IsPassword || credential.IsMatch(e.Name ?? ""))).ToArray();
        var elements = visibleElements.Take(500).ToArray();
        string? data = null; var width = 0; var height = 0;
        if (image)
        {
            var captured = await WindowsToolsBase.ScreenshotService.ExecuteAsync(new ScreenshotControlRequest { Target = CaptureTarget.Window, WindowHandle = window.Handle, ImageFormat = Sbroenne.WindowsMcp.Models.ImageFormat.Png, OutputMode = OutputMode.Inline }, scope.Token);
            if (!captured.Success || captured.ImageData is null) throw new ComputerError("CAPTURE_UNAVAILABLE", "This window could not be captured directly. Screen-wide fallback is disabled.");
            using var stream = new MemoryStream(Convert.FromBase64String(captured.ImageData)); using var original = Image.FromStream(stream);
            var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height)); width = Math.Max(1, (int)(original.Width * scale)); height = Math.Max(1, (int)(original.Height * scale));
            using var bitmap = new Bitmap(width, height); using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.DrawImage(original, new Rectangle(0, 0, width, height));
                foreach (var r in CredentialMasks(visibleElements))
                {
                    graphics.FillRectangle(Brushes.Black, (float)((r.X - window.Bounds.X) * (double)width / window.Bounds.Width), (float)((r.Y - window.Bounds.Y) * (double)height / window.Bounds.Height), (float)(r.Width * (double)width / window.Bounds.Width), (float)(r.Height * (double)height / window.Bounds.Height));
                }
            }
            using var output = new MemoryStream(); bitmap.Save(output, System.Drawing.Imaging.ImageFormat.Png);
            if (output.Length > 1400 * 1024) throw new ComputerError("CAPTURE_TOO_LARGE", "Choose a smaller window for a bounded capture.");
            data = "data:image/png;base64," + Convert.ToBase64String(output.ToArray());
        }
        scope.Token.ThrowIfCancellationRequested();
        var observation = new Observation(Guid.NewGuid().ToString(), window, elements, DateTime.UtcNow, data, width, height);
        while (observations.Count >= 16) observations.Remove(observations.Keys.First());
        observations[observation.Id] = (observation with { Image = image ? "captured" : null }, local ? "local" : lease, scope.Epoch);
        return observation;
    }
    public async Task<object> Act(string lease, string observationId, JsonElement action, CancellationToken token)
    {
        if (!observations.TryGetValue(observationId, out var snapshot) || snapshot.Lease != lease || snapshot.Epoch != Authority.Epoch || DateTime.UtcNow - snapshot.Value.Created > TimeSpan.FromSeconds(30)) throw new ComputerError("OBSERVATION_EXPIRED", "Take a fresh observation after the window or control state changes.");
        var view = snapshot.Value;
        using var scope = Authority.Begin(lease, view.Window, true, false, token);
        if (!Validate(view.Window, true)) throw new ComputerError("NEEDS_FOCUS", "Bring the selected window forward, then observe again before acting.");
        var kind = Text(action, "kind"); var elementId = Text(action, "elementId", false); var element = view.Elements.FirstOrDefault(e => e.Id == elementId);
        if (kind is "click" or "type" or "select")
        {
            if (element is null || !element.Enabled) throw new ComputerError("STALE_ELEMENT", "Choose an enabled element from the latest observation.");
            if (element.Password) throw new ComputerError("USER_TAKEOVER", "Enter credentials yourself, then hand control back.");
            var current = await WindowsToolsBase.UIAutomationService.ResolveElementAsync(elementId, scope.Token);
            if (current is null || current.IsPassword || !current.IsEnabled || current.IsOffscreen || current.Name != element.Name || current.ControlType != element.Role || current.BoundingRect.X != element.Bounds.X || current.BoundingRect.Y != element.Bounds.Y || current.BoundingRect.Width != element.Bounds.Width || current.BoundingRect.Height != element.Bounds.Height) throw new ComputerError("STALE_ELEMENT", "The observed control changed. Observe the window again before acting.");

        }
        Authority.BeforeInput();
        object result;
        try
        {
            result = kind switch
            {
                "click" => await WindowsToolsBase.UIAutomationService.ClickElementAsync(elementId, view.Window.Handle, scope.Token),
                "type" => await WindowsToolsBase.UIAutomationService.TypeIntoElementAsync(elementId, Text(action, "text", true, 4096), action.TryGetProperty("clearFirst", out var clear) && clear.ValueKind == JsonValueKind.True, view.Window.Handle, "keyboard", scope.Token),
                "select" => await WindowsToolsBase.UIAutomationService.SelectElementAsync(elementId, Text(action, "value", true, 1024), view.Window.Handle, scope.Token),
                "key" => await Key(action, scope.Token),
                "scroll" => await Scroll(action, view, scope.Token),
                "click-point" => await ClickPoint(action, view, scope.Token),
                _ => throw new ComputerError("UNSUPPORTED_ACTION", "Use one supported, bounded action per step.")
            };
        }
        finally { await WindowsToolsBase.KeyboardInputService.ReleaseAllKeysAsync(CancellationToken.None); observations.Remove(observationId); }
        var encoded = JsonSerializer.SerializeToElement(result, Program.Json);
        var success = encoded.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.True;
        return new { status = success ? "dispatched" : "uncertain", actionDispatched = success, outcomeVerified = false, message = success ? "Action dispatched. Observe the window to verify the intended outcome." : "The action did not report completion. Observe its state before considering another action." };
    }
    public async Task<object> Focus(string lease, string windowId, CancellationToken token)
    {
        var window = Window(windowId); using var scope = Authority.Begin(lease, window, true, false, token);
        var result = await WindowsToolsBase.WindowService.ActivateWindowAsync(nint.Parse(window.Handle), scope.Token);
        ClearObservations(); return new { status = result.Success ? "dispatched" : "blocked", outcomeVerified = false };
    }
    private async Task<object> Key(JsonElement action, CancellationToken token)
    {
        var key = Text(action, "key", true, 32);
        var named = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "enter", "return", "tab", "escape", "esc", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "left", "right", "up", "down", "space", "arrowleft", "arrowright", "arrowup", "arrowdown" };
        if (!(key.Length == 1 && char.IsLetterOrDigit(key[0])) && !named.Contains(key)) throw new ComputerError("GLOBAL_KEY_BLOCKED", "Use a supported window-scoped key. Desktop shortcuts require user takeover.");
        if (key.StartsWith("arrow", StringComparison.OrdinalIgnoreCase)) key = key[5..];
        var modifiers = ModifierKey.None;
        if (action.TryGetProperty("modifiers", out var values)) foreach (var value in values.EnumerateArray()) modifiers |= value.GetString()?.ToLowerInvariant() switch { "ctrl" => ModifierKey.Ctrl, "shift" => ModifierKey.Shift, "alt" => ModifierKey.Alt, _ => throw new ComputerError("GLOBAL_KEY_BLOCKED", "Only window-scoped Ctrl, Shift, and Alt combinations are supported.") };
        if (key.Equals("win", StringComparison.OrdinalIgnoreCase) || modifiers.HasFlag(ModifierKey.Alt) && key.ToLowerInvariant() is "tab" or "escape" or "esc" || modifiers.HasFlag(ModifierKey.Ctrl) && (modifiers.HasFlag(ModifierKey.Alt) || key.ToLowerInvariant() is "escape" or "esc")) throw new ComputerError("GLOBAL_KEY_BLOCKED", "Global desktop and security shortcuts require user takeover.");
        return await WindowsToolsBase.KeyboardInputService.PressKeyAsync(key, modifiers, 1, token);
    }
    private static (int X, int Y) Point(JsonElement action, Observation view)
    {
        if (view.Image is null || !action.TryGetProperty("x", out var x) || !action.TryGetProperty("y", out var y) || !x.TryGetDouble(out var px) || !y.TryGetDouble(out var py) || !double.IsFinite(px) || !double.IsFinite(py) || px < 0 || py < 0 || px >= view.Width || py >= view.Height) throw new ComputerError("INVALID_POINT", "Use a point inside the latest window screenshot.");
        var target = (X: view.Window.Bounds.X + (int)(px * view.Window.Bounds.Width / view.Width), Y: view.Window.Bounds.Y + (int)(py * view.Window.Bounds.Height / view.Height));
        if (GetAncestor(WindowFromPoint(new NativePoint { X = target.X, Y = target.Y }), 2).ToInt64().ToString() != view.Window.Handle) throw new ComputerError("OCCLUDED_TARGET", "Another window covers this point. Observe again after restoring the target.");
        return target;
    }
    private static async Task<object> ClickPoint(JsonElement action, Observation view, CancellationToken token) { var p = Point(action, view); return await WindowsToolsBase.MouseInputService.ClickAsync(p.X, p.Y, ModifierKey.None, token); }
    private static async Task<object> Scroll(JsonElement action, Observation view, CancellationToken token) { var p = Point(action, view); if (!Enum.TryParse<ScrollDirection>(Text(action, "direction"), true, out var direction)) throw new ComputerError("INVALID_SCROLL", "Choose up, down, left, or right."); var amount = action.TryGetProperty("amount", out var a) && a.TryGetInt32(out var n) ? n : 3; if (amount is < 1 or > 10) throw new ComputerError("INVALID_SCROLL", "Scroll one to ten increments at a time."); return await WindowsToolsBase.MouseInputService.ScrollAsync(direction, amount, p.X, p.Y, token); }
    internal static string Text(JsonElement value, string key, bool required = true, int limit = 256) { if (!value.TryGetProperty(key, out var item) || item.ValueKind != JsonValueKind.String) { if (!required) return ""; throw new ComputerError("INVALID_ARGUMENT", $"Provide {key}."); } var text = item.GetString()!; if (text.Length > limit || required && text.Length == 0) throw new ComputerError("INVALID_ARGUMENT", $"{key} is empty or exceeds its limit."); return text; }
}
