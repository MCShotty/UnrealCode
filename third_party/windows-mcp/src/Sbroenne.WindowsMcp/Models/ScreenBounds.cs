using Sbroenne.WindowsMcp.Native;

namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Represents the virtual screen geometry encompassing all monitors.
/// </summary>
/// <param name="Left">The left edge of the virtual screen (can be negative).</param>
/// <param name="Top">The top edge of the virtual screen (can be negative).</param>
/// <param name="Width">The width of the virtual screen in pixels.</param>
/// <param name="Height">The height of the virtual screen in pixels.</param>
public readonly record struct ScreenBounds(int Left, int Top, int Width, int Height)
{
    /// <summary>
    /// Gets the right edge of the virtual screen.
    /// </summary>
    public int Right => Left + Width;

    /// <summary>
    /// Gets the bottom edge of the virtual screen.
    /// </summary>
    public int Bottom => Top + Height;

    /// <summary>
    /// Gets the current virtual screen bounds from the system.
    /// </summary>
    /// <returns>The virtual screen bounds encompassing all monitors.</returns>
    public static ScreenBounds GetVirtual()
    {
        var left = NativeMethods.GetSystemMetrics(NativeConstants.SM_XVIRTUALSCREEN);
        var top = NativeMethods.GetSystemMetrics(NativeConstants.SM_YVIRTUALSCREEN);
        var width = NativeMethods.GetSystemMetrics(NativeConstants.SM_CXVIRTUALSCREEN);
        var height = NativeMethods.GetSystemMetrics(NativeConstants.SM_CYVIRTUALSCREEN);

        return new ScreenBounds(left, top, width, height);
    }

    /// <inheritdoc/>
    public override string ToString() => $"[({Left}, {Top}) - ({Right}, {Bottom})]";
}
