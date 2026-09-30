namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Represents the visual state of a window.
/// </summary>
public enum WindowState
{
    /// <summary>Window is in normal (restored) state.</summary>
    Normal,

    /// <summary>Window is minimized to the taskbar.</summary>
    Minimized,

    /// <summary>Window is maximized to fill the screen.</summary>
    Maximized,

    /// <summary>Window is hidden (not visible).</summary>
    Hidden
}
