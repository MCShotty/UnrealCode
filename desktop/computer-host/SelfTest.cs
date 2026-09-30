using Sbroenne.WindowsMcp.Models;

namespace UnrealCode.ComputerHost;

internal static class SelfTest
{
    public static int Run()
    {
        var valid = true;
        using var authority = new NativeAuthority((_, _) => valid);
        var window = new Surface("window", "1", 2, "3", "fixture", "fixture", new WindowBounds { X=0, Y=0, Width=100, Height=100 }, 96, "desktop", null);
        var lease = Guid.NewGuid().ToString(); var task = Guid.NewGuid().ToString();
        void Blocked(Action action) { try { action(); throw new Exception("An unauthorized operation was accepted"); } catch (ComputerError) { } }
        Blocked(() => authority.Begin(lease, window, true, false, default));
        authority.Grant(lease, task, false, [window]);
        Blocked(() => authority.Begin(lease, window, true, false, default));
        using (authority.Begin(lease, window, false, false, default)) Blocked(authority.BeforeInput);
        authority.Grant(lease, task, true, [window]);
        using (authority.Begin(lease, window, true, false, default))
        {
            authority.BeforeInput(); authority.Pause(); Blocked(authority.BeforeInput);
            authority.Resume(lease); Blocked(authority.BeforeInput);
        }
        using (authority.Begin(lease, window, true, false, default)) { valid = false; Blocked(authority.BeforeInput); valid = true; authority.Stop(); Blocked(authority.BeforeInput); }
        Blocked(() => authority.Resume(lease));
        authority.Grant(lease, task, true, [window]);
        using (authority.Begin(lease, window, false, true, default)) { Blocked(authority.BeforeInput); Blocked(() => authority.BeforeForeground(1)); }
        var queuedEpoch = authority.Epoch;
        authority.Stop();
        Blocked(() => authority.Grant(lease, task, true, [window], queuedEpoch));
        authority.Grant(lease, task, true, [window]);
        queuedEpoch = authority.Epoch;
        authority.Pause();
        Blocked(() => authority.Resume(lease, queuedEpoch));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        try { authority.Grant(lease, task, true, [window], authority.Epoch, cancelled.Token); throw new Exception("Cancelled grant was accepted"); } catch (OperationCanceledException) { }
        var rect = new BoundingRect { X=1, Y=2, Width=30, Height=40 };
        var visible = Enumerable.Range(0, 501).Select(index => new ObservedElement(index.ToString(), "fixture", "Edit", true, rect, index == 500)).ToArray();
        if (WindowsDriver.CredentialMasks(visible).Length != 1) throw new Exception("Credential masks were truncated with model-visible elements");
        Blocked(() => WindowsDriver.CheckCapture(window.Bounds, "scoped-parent"));
        Blocked(() => WindowsDriver.CheckCapture(new WindowBounds { X=0, Y=0, Width=16000, Height=16000 }, null));
        WindowsDriver.CheckCapture(window.Bounds, null);
        Console.WriteLine("PASS: grant ownership, observation-only, takeover, stale epoch, changed window, stop and local preview boundaries.");
        return 0;
    }
}
