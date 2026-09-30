namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Represents a screen position in physical pixels.
/// </summary>
/// <param name="X">The x-coordinate in screen pixels.</param>
/// <param name="Y">The y-coordinate in screen pixels.</param>
public readonly record struct Coordinates(int X, int Y)
{
    /// <summary>
    /// Gets the coordinates of the current cursor position.
    /// </summary>
    /// <returns>The current cursor coordinates.</returns>
    public static Coordinates FromCurrent()
    {
        _ = Native.NativeMethods.GetCursorPos(out var point);
        return new Coordinates(point.X, point.Y);
    }

    /// <summary>
    /// Determines whether these coordinates are within the specified screen bounds.
    /// </summary>
    /// <param name="bounds">The screen bounds to check against.</param>
    /// <returns>True if the coordinates are within bounds; otherwise, false.</returns>
    public bool IsWithinBounds(ScreenBounds bounds)
    {
        return X >= bounds.Left && X < bounds.Right &&
               Y >= bounds.Top && Y < bounds.Bottom;
    }

    /// <inheritdoc/>
    public override string ToString() => $"({X}, {Y})";
}
