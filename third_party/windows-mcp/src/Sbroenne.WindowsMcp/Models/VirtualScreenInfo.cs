using System.Text.Json.Serialization;

namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Describes the virtual screen that spans all monitors.
/// </summary>
/// <param name="X">Left edge X coordinate (can be negative if monitors are to the left of primary).</param>
/// <param name="Y">Top edge Y coordinate.</param>
/// <param name="Width">Total width spanning all monitors.</param>
/// <param name="Height">Total height spanning all monitors.</param>
public sealed record VirtualScreenInfo(
    [property: JsonPropertyName("x")] int X,
    [property: JsonPropertyName("y")] int Y,
    [property: JsonPropertyName("width")] int Width,
    [property: JsonPropertyName("height")] int Height);
