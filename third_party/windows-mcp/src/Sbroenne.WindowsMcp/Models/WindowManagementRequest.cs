using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Sbroenne.WindowsMcp.Models;

/// <summary>
/// Request parameters for window management operations.
/// </summary>
public sealed record WindowManagementRequest
{
    /// <summary>
    /// Gets the window management action to perform.
    /// </summary>
    [Required]
    [JsonPropertyName("action")]
    public required WindowAction Action { get; init; }

    /// <summary>
    /// Gets the window handle (HWND) as decimal string.
    /// Required for: activate, minimize, maximize, restore, close, move, resize, set_bounds.
    /// </summary>
    [JsonPropertyName("handle")]
    public string? Handle { get; init; }

    /// <summary>
    /// Gets the title search string for find and wait_for actions.
    /// Matches as substring unless regex=true.
    /// </summary>
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    /// <summary>
    /// Gets a value indicating whether to treat title as a regex pattern.
    /// </summary>
    [JsonPropertyName("regex")]
    public bool Regex { get; init; }

    /// <summary>
    /// Gets the filter for list action. Matches title or process name (case-insensitive substring).
    /// </summary>
    [JsonPropertyName("filter")]
    public string? Filter { get; init; }

    /// <summary>
    /// Gets the X coordinate for move and set_bounds actions.
    /// </summary>
    [JsonPropertyName("x")]
    public int? X { get; init; }

    /// <summary>
    /// Gets the Y coordinate for move and set_bounds actions.
    /// </summary>
    [JsonPropertyName("y")]
    public int? Y { get; init; }

    /// <summary>
    /// Gets the width for resize and set_bounds actions.
    /// </summary>
    [JsonPropertyName("width")]
    public int? Width { get; init; }

    /// <summary>
    /// Gets the height for resize and set_bounds actions.
    /// </summary>
    [JsonPropertyName("height")]
    public int? Height { get; init; }

    /// <summary>
    /// Gets the timeout in milliseconds for wait_for action.
    /// </summary>
    [JsonPropertyName("timeout_ms")]
    public int? TimeoutMs { get; init; }

    /// <summary>
    /// Gets a value indicating whether to include hidden (non-visible) windows.
    /// </summary>
    [JsonPropertyName("include_hidden")]
    public bool IncludeHidden { get; init; }

    /// <summary>
    /// Gets a value indicating whether to include windows on other virtual desktops.
    /// </summary>
    [JsonPropertyName("include_all_desktops")]
    public bool IncludeAllDesktops { get; init; }

    /// <summary>
    /// Gets a value indicating whether to include DWM-cloaked windows.
    /// </summary>
    [JsonPropertyName("include_cloaked")]
    public bool IncludeCloaked { get; init; }

    /// <summary>
    /// Validates the request based on the action type.
    /// </summary>
    /// <returns>A validation result indicating success or failure with error details.</returns>
    public (bool IsValid, WindowManagementErrorCode? ErrorCode, string? ErrorMessage) Validate()
    {
        return Action switch
        {
            WindowAction.Activate or WindowAction.Minimize or WindowAction.Maximize or
            WindowAction.Restore or WindowAction.Close when string.IsNullOrEmpty(Handle) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    $"{Action} action requires 'handle' parameter."),

            WindowAction.Move when string.IsNullOrEmpty(Handle) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "Move action requires 'handle' parameter."),

            WindowAction.Move when !X.HasValue || !Y.HasValue =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "Move action requires both 'x' and 'y' coordinates."),

            WindowAction.Resize when string.IsNullOrEmpty(Handle) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "Resize action requires 'handle' parameter."),

            WindowAction.Resize when !Width.HasValue || !Height.HasValue =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "Resize action requires both 'width' and 'height'."),

            WindowAction.Resize when Width < 1 || Height < 1 =>
                (false, WindowManagementErrorCode.InvalidCoordinates,
                    "Width and height must be positive values."),

            WindowAction.SetBounds when string.IsNullOrEmpty(Handle) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "SetBounds action requires 'handle' parameter."),

            WindowAction.SetBounds when !X.HasValue || !Y.HasValue || !Width.HasValue || !Height.HasValue =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "SetBounds action requires 'x', 'y', 'width', and 'height'."),

            WindowAction.SetBounds when Width < 1 || Height < 1 =>
                (false, WindowManagementErrorCode.InvalidCoordinates,
                    "Width and height must be positive values."),

            WindowAction.Find when string.IsNullOrEmpty(Title) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "Find action requires 'title' parameter."),

            WindowAction.WaitFor when string.IsNullOrEmpty(Title) =>
                (false, WindowManagementErrorCode.MissingRequiredParameter,
                    "WaitFor action requires 'title' parameter."),

            WindowAction.WaitFor when TimeoutMs.HasValue && TimeoutMs < 0 =>
                (false, WindowManagementErrorCode.InvalidCoordinates,
                    "Timeout must be a non-negative value."),

            _ => (true, null, null)
        };
    }

    /// <summary>
    /// Parses the handle string to an IntPtr.
    /// </summary>
    /// <returns>The parsed handle, or IntPtr.Zero if invalid.</returns>
    public nint ParseHandle()
    {
        if (string.IsNullOrEmpty(Handle))
        {
            return nint.Zero;
        }

        if (long.TryParse(Handle, out var handleValue))
        {
            return new nint(handleValue);
        }

        return nint.Zero;
    }
}
