using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Sbroenne.WindowsMcp;
using Sbroenne.WindowsMcp.Tools;

namespace UnrealCode.ComputerHost;

internal static class Program
{
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private static readonly object output = new();
    private static void Write(object value) { lock (output) Console.WriteLine(JsonSerializer.Serialize(value, Json)); }
    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--self-test" })) return SelfTest.Run();
        if (args.Length != 2 || args[0] != "--parent" || !int.TryParse(args[1], out var parent)) return 2;
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        using var lifetime = new CancellationTokenSource();
        var driver = new WindowsDriver(parent);
        using var authority = driver.Authority;
        using var input = new PhysicalInputMonitor(() => authority.Pause());
        ManagedDispatchGuard.BeforeInput = authority.BeforeInput;
        ManagedDispatchGuard.BeforeForeground = authority.BeforeForeground;
        ManagedDispatchGuard.WindowCaptureOnly = true;
        authority.Changed = () => Write(new { @event = "status", status = authority.Status });
        var requests = new ConcurrentDictionary<string, CancellationTokenSource>();
        using var lane = new SemaphoreSlim(1, 1);
        using var watchdog = new System.Threading.Timer(_ =>
        {
            try { using var process = Process.GetProcessById(parent); if (process.HasExited) lifetime.Cancel(); else driver.CheckEnvironment(); }
            catch { lifetime.Cancel(); }
        }, null, 500, 500);
        using var exit = lifetime.Token.Register(() => { authority.Stop("UnrealCode disconnected."); _ = Task.Run(async () => { await WindowsToolsBase.KeyboardInputService.ReleaseAllKeysAsync(); Environment.Exit(0); }); });
        Write(new { @event = "ready", protocol = 1, generation = driver.Generation, inputMonitor = input.Ready, desktopReady = driver.DesktopReady, elevated = driver.Elevated });
        try
        {
            while (await Console.In.ReadLineAsync(lifetime.Token) is { } line)
            {
                if (line.Length > 128 * 1024) return 3;
                using var parsed = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 24 });
                var request = parsed.RootElement.Clone();
                var id = WindowsDriver.Text(request, "id", limit: 100);
                var method = WindowsDriver.Text(request, "method");
                var payload = request.TryGetProperty("payload", out var p) ? p : JsonSerializer.SerializeToElement(new { });
                if (method is "pause" or "stop" or "cancel")
                {
                    if (method == "pause") authority.Pause();
                    else if (method == "stop") authority.Stop();
                    if (method is "pause" or "stop") foreach (var pending in requests.Values) { try { pending.Cancel(); } catch (ObjectDisposedException) { } }
                    else if (requests.TryGetValue(WindowsDriver.Text(payload, "requestId"), out var pending)) { try { pending.Cancel(); } catch (ObjectDisposedException) { } }
                    Write(new { id, result = authority.Status }); continue;
                }
                if (requests.Count >= 8 || requests.ContainsKey(id)) { Write(new { id, error = new { code = "BUSY", message = "Native request queue is full. Wait for the current operation." } }); continue; }
                var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); cancellation.CancelAfter(TimeSpan.FromSeconds(30)); requests[id] = cancellation;
                var requestEpoch = authority.Epoch;
                _ = Task.Run(async () =>
                {
                    var entered = false;
                    try
                    {
                        await lane.WaitAsync(cancellation.Token); entered = true;
                        object result;
                        switch (method)
                        {
                            case "status": result = authority.Status; break;
                            case "windows": result = await driver.Windows(cancellation.Token); break;
                            case "grant":
                                await input.Settle(cancellation.Token);
                                var windows = payload.GetProperty("windows").EnumerateArray().Select(w => driver.Window(w.GetString()!)).ToArray();
                                authority.Grant(WindowsDriver.Text(payload, "leaseId"), WindowsDriver.Text(payload, "taskId"), payload.GetProperty("control").GetBoolean(), windows, requestEpoch, cancellation.Token);
                                driver.ClearObservations(); result = authority.Status; break;
                            case "resume": await input.Settle(cancellation.Token); authority.Resume(WindowsDriver.Text(payload, "leaseId"), requestEpoch, cancellation.Token); driver.ClearObservations(); result = authority.Status; break;
                            case "observe": result = await driver.Observe(WindowsDriver.Text(payload, "leaseId", false), WindowsDriver.Text(payload, "windowId"), payload.TryGetProperty("parentElement", out var element) ? element.GetString() : null, payload.TryGetProperty("image", out var image) && image.GetBoolean(), payload.TryGetProperty("local", out var local) && local.GetBoolean(), cancellation.Token); break;
                            case "act": result = await driver.Act(WindowsDriver.Text(payload, "leaseId"), WindowsDriver.Text(payload, "observationId"), payload.GetProperty("action"), cancellation.Token); break;
                            case "focus": result = await driver.Focus(WindowsDriver.Text(payload, "leaseId"), WindowsDriver.Text(payload, "windowId"), cancellation.Token); break;
                            default: throw new ComputerError("UNKNOWN_METHOD", "Unsupported managed computer operation.");
                        }
                        cancellation.Token.ThrowIfCancellationRequested(); Write(new { id, result });
                    }
                    catch (Exception error) { Write(new { id, error = new { code = error is ComputerError computer ? computer.Code : error is OperationCanceledException ? "CANCELLED" : "NATIVE_FAILURE", message = error is ComputerError ? error.Message : error is OperationCanceledException ? "Operation cancelled. Observe again before considering a retry." : "Windows could not complete this operation. Refresh the selected window." } }); }
                    finally { if (entered) lane.Release(); requests.TryRemove(id, out _); cancellation.Dispose(); }
                });
            }
        }
        catch (OperationCanceledException) { }
        finally { authority.Stop(); foreach (var request in requests.Values) request.Cancel(); await WindowsToolsBase.KeyboardInputService.ReleaseAllKeysAsync(); }
        return 0;
    }
}
