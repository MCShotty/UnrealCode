using System.Diagnostics;
using System.Runtime.InteropServices;
using Sbroenne.WindowsMcp;
using Sbroenne.WindowsMcp.Models;

namespace UnrealCode.ComputerHost;

internal sealed record Surface(string Id, string Handle, int ProcessId, string Started, string Title, string Process, WindowBounds Bounds, uint Dpi, string Desktop, string? Blocked);
internal sealed record ObservedElement(string Id, string Name, string Role, bool Enabled, BoundingRect Bounds, bool Password);
internal sealed record Observation(string Id, Surface Window, IReadOnlyList<ObservedElement> Elements, DateTime Created, string? Image = null, int Width = 0, int Height = 0);
internal sealed record Lease(string Id, string Task, bool Control, Dictionary<string, Surface> Windows, DateTime Created);
internal sealed class ComputerError(string code, string message) : Exception(message) { public string Code { get; } = code; }

internal sealed class NativeAuthority : IDisposable
{
    private readonly object gate = new();
    private Lease? lease;
    private bool paused;
    private string reason = "Choose windows and grant this task access.";
    private Scope? scope;
    private long inputEpoch;
    private readonly Func<Surface, bool, bool> validate;
    public Action? Changed { get; set; }
    public NativeAuthority(Func<Surface, bool, bool> validate) { this.validate = validate; }
    public object Status { get { lock (gate) return new { leaseId = lease?.Id, taskId = lease?.Task, state = lease is null ? "ready" : paused ? "paused" : "active", message = reason, windows = lease?.Windows.Keys.ToArray() ?? [] }; } }
    public Lease? Current { get { lock (gate) return lease; } }
    public long Epoch { get { lock (gate) return inputEpoch; } }
    public void Grant(string id, string task, bool control, IReadOnlyList<Surface> windows, long? requestEpoch = null, CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(id, out _) || !Guid.TryParse(task, out _) || windows.Count is < 1 or > 8 || windows.Any(w => w.Blocked != null || !validate(w, false))) throw new ComputerError("INVALID_GRANT", "Choose up to eight available windows again.");
        lock (gate) { CheckRequest(requestEpoch, cancellationToken); scope?.Cancel(); inputEpoch++; lease = new(id, task, control, windows.ToDictionary(w => w.Id), DateTime.UtcNow); paused = false; reason = "Selected windows are shared with this task."; }
        Changed?.Invoke();
    }
    public void Pause(string message = "You have control. Hand back explicitly when ready.")
    {
        lock (gate) { if (lease is null || paused) return; paused = true; reason = message; inputEpoch++; if (scope?.Local != true) scope?.Cancel(); }
        ThreadPool.QueueUserWorkItem(_ => Changed?.Invoke());
    }
    public void Stop(string message = "Computer control stopped.")
    {
        lock (gate) { scope?.Cancel(); lease = null; paused = false; reason = message; inputEpoch++; }
        Changed?.Invoke();
    }
    private void CheckRequest(long? epoch, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (epoch.HasValue && epoch.Value != inputEpoch) throw new ComputerError("CONTROL_CHANGED", "Control changed while this request was waiting. Review access or hand back explicitly.");
    }
    public void Resume(string id, long? requestEpoch = null, CancellationToken cancellationToken = default)
    {
        lock (gate) { CheckRequest(requestEpoch, cancellationToken); if (lease?.Id != id || lease.Windows.Values.Any(w => !validate(w, false))) throw new ComputerError("GRANT_CHANGED", "The selected windows changed. Review access again."); paused = false; inputEpoch++; reason = "Control handed back. Take a fresh observation before acting."; }
        Changed?.Invoke();
    }
    public Scope Begin(string id, Surface window, bool interaction, bool local, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (!local && (lease?.Id != id || !lease.Windows.ContainsKey(window.Id))) throw new ComputerError("NEEDS_GRANT", "Grant this task access to the selected window in Computer.");
            if (!local && paused) throw new ComputerError("NEEDS_HANDBACK", reason);
            if (interaction && (local || lease?.Control != true)) throw new ComputerError("OBSERVE_ONLY", "This task has observation access only.");
            if (window.Blocked != null || !validate(window, false)) throw new ComputerError("WINDOW_CHANGED", "This window is unavailable or its identity changed.");
            if (scope != null) throw new ComputerError("BUSY", "Another native observation or action is settling.");
            scope = new(this, window, interaction, local, inputEpoch, CancellationTokenSource.CreateLinkedTokenSource(cancellationToken));
            return scope;
        }
    }
    public void BeforeInput()
    {
        lock (gate)
        {
            var current = scope;
            if (current is null || !current.Interaction || current.Local || paused || current.Epoch != inputEpoch || current.Token.IsCancellationRequested || lease?.Control != true || !lease.Windows.ContainsKey(current.Window.Id) || !validate(current.Window, true)) throw new ComputerError("INPUT_BLOCKED", "Input stopped because control, focus, or the target changed. Observe again after handback.");
        }
    }
    public void BeforeForeground(nint handle)
    {
        lock (gate)
        {
            var current = scope;
            if (current is null || !current.Interaction || current.Local || paused || current.Epoch != inputEpoch || current.Token.IsCancellationRequested || current.Window.Handle != handle.ToInt64().ToString() || !validate(current.Window, false)) throw new ComputerError("FOCUS_BLOCKED", "Observation cannot change focus, and input cannot focus an ungranted window.");
        }
    }
    public void Dispose() => Stop();
    internal sealed class Scope(NativeAuthority owner, Surface window, bool interaction, bool local, long epoch, CancellationTokenSource cancellation) : IDisposable
    {
        public Surface Window { get; } = window;
        public bool Interaction { get; } = interaction;
        public bool Local { get; } = local;
        public long Epoch { get; } = epoch;
        public CancellationToken Token => cancellation.Token;
        public void Cancel() { try { cancellation.Cancel(); } catch (ObjectDisposedException) { } }
        public void Dispose() { lock (owner.gate) { if (owner.scope == this) owner.scope = null; cancellation.Dispose(); } }
    }
}

internal sealed class PhysicalInputMonitor : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardData { public uint Key, Scan, Flags, Time; public nuint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseData { public int X, Y; public uint Data, Flags, Time; public nuint Extra; }
    private delegate nint Hook(int code, nint kind, nint data);
    [DllImport("user32.dll", SetLastError = true)] private static extern nint SetWindowsHookEx(int id, Hook callback, nint module, uint thread);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook, int code, nint kind, nint data);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern nint GetModuleHandle(string? module);
    private readonly Hook keyboard, mouse;
    private readonly ApplicationContext context = new();
    private readonly Thread thread;
    private nint keyboardHook, mouseHook;
    private long lastInput;
    public bool Ready { get; private set; }
    public PhysicalInputMonitor(Action onInput)
    {
        void Notice() { Interlocked.Exchange(ref lastInput, Environment.TickCount64); onInput(); }
        keyboard = (code, kind, data) => { if (code >= 0 && Marshal.PtrToStructure<KeyboardData>(data).Extra != ManagedDispatchGuard.InputTag) Notice(); return CallNextHookEx(0, code, kind, data); };
        mouse = (code, kind, data) => { if (code >= 0 && Marshal.PtrToStructure<MouseData>(data).Extra != ManagedDispatchGuard.InputTag) Notice(); return CallNextHookEx(0, code, kind, data); };
        var started = new ManualResetEventSlim();
        thread = new Thread(() => { keyboardHook = SetWindowsHookEx(13, keyboard, GetModuleHandle(null), 0); mouseHook = SetWindowsHookEx(14, mouse, GetModuleHandle(null), 0); Ready = keyboardHook != 0 && mouseHook != 0; started.Set(); if (Ready) Application.Run(context); if (keyboardHook != 0) UnhookWindowsHookEx(keyboardHook); if (mouseHook != 0) UnhookWindowsHookEx(mouseHook); }) { IsBackground = true, Name = "Computer input takeover" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); started.Wait(TimeSpan.FromSeconds(3));
    }
    public async Task Settle(CancellationToken token)
    {
        if (!Ready) throw new ComputerError("INPUT_MONITOR_UNAVAILABLE", "Physical input detection is unavailable. Computer control remains disabled.");
        for (var i = 0; i < 15; i++) { token.ThrowIfCancellationRequested(); if (Environment.TickCount64 - Interlocked.Read(ref lastInput) >= 180) return; await Task.Delay(100, token); }
        throw new ComputerError("DESKTOP_IN_USE", "Leave the desktop idle briefly, then hand control back.");
    }
    public void Dispose() { context.ExitThread(); thread.Join(1000); GC.KeepAlive(keyboard); GC.KeepAlive(mouse); }
}
