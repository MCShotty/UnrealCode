namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Specifies the direction for scroll operations.
/// </summary>
public enum ScrollDirection
{
    /// <summary>Scroll content upward (wheel away from user).</summary>
    Up,

    /// <summary>Scroll content downward (wheel toward user).</summary>
    Down,

    /// <summary>Scroll content left (horizontal scroll).</summary>
    Left,

    /// <summary>Scroll content right (horizontal scroll).</summary>
    Right
}
