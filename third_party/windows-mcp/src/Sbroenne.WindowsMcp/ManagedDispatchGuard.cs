namespace Sbroenne.WindowsMcp;

/// <summary>UnrealCode adaptation. The embedding host owns the revocable lease.
/// Guards run at the actual native/COM dispatch boundary, not just at tool entry.</summary>
public static class ManagedDispatchGuard
{
    /// <summary>Identifies our injected input to the physical-input monitor.</summary>
    public static readonly nuint InputTag = 0x55434F44;
    /// <summary>Called immediately before an input or COM action.</summary>
    public static Action? BeforeInput { get; set; }
    /// <summary>Called before changing the foreground window.</summary>
    public static Action<nint>? BeforeForeground { get; set; }
    /// <summary>Managed captures cannot fall back to pixels belonging to other windows.</summary>
    public static bool WindowCaptureOnly { get; set; }
    /// <summary>Recheck the host lease, cancellation, and observed target.</summary>
    public static void Check() => BeforeInput?.Invoke();
}
