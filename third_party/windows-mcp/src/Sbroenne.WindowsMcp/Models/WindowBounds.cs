using System.Text.Json.Serialization;

namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Represents the position and size of a window in physical screen pixels.
/// </summary>
public sealed record WindowBounds
{
    /// <summary>
    /// Gets the left edge X coordinate.
    /// </summary>
    [JsonPropertyName("x")]
    public required int X { get; init; }

    /// <summary>
    /// Gets the top edge Y coordinate.
    /// </summary>
    [JsonPropertyName("y")]
    public required int Y { get; init; }

    /// <summary>
    /// Gets the window width in pixels.
    /// </summary>
    [JsonPropertyName("width")]
    public required int Width { get; init; }

    /// <summary>
    /// Gets the window height in pixels.
    /// </summary>
    [JsonPropertyName("height")]
    public required int Height { get; init; }

    /// <summary>
    /// Gets the right edge X coordinate (computed).
    /// </summary>
    [JsonIgnore]
    public int Right => X + Width;

    /// <summary>
    /// Gets the bottom edge Y coordinate (computed).
    /// </summary>
    [JsonIgnore]
    public int Bottom => Y + Height;

    /// <summary>
    /// Creates a WindowBounds from a RECT structure.
    /// </summary>
    /// <param name="left">Left edge X coordinate.</param>
    /// <param name="top">Top edge Y coordinate.</param>
    /// <param name="right">Right edge X coordinate.</param>
    /// <param name="bottom">Bottom edge Y coordinate.</param>
    /// <returns>A new WindowBounds instance.</returns>
    public static WindowBounds FromRect(int left, int top, int right, int bottom)
    {
        return new WindowBounds
        {
            X = left,
            Y = top,
            Width = right - left,
            Height = bottom - top
        };
    }
}
