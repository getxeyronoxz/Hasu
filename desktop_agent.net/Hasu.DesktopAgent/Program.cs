using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
// Loopback-only: Hasu backend is always on the same machine.
app.Use(async (context, next) =>
{
    var ip = context.Connection.RemoteIpAddress?.ToString();
    if (ip is not (null or "127.0.0.1" or "::1"))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    await next();
});
// When running in development, bind to the same port as the Python agent.
if (!app.Environment.IsDevelopment())
{
    // Production default can be overridden via configuration or args.
}
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    tool_count = DesktopTools.ToolNames.Count,
    tools = DesktopTools.ToolNames
}));
app.MapGet("/tools", () => Results.Ok(new
{
    tools = DesktopTools.ToolNames
}));
app.MapPost("/execute", async (JsonElement body) =>
{
    if (!body.TryGetProperty("tool", out var toolEl) || toolEl.ValueKind != JsonValueKind.String)
        return Results.BadRequest(new { ok = false, error = "missing 'tool'" });
    var tool = toolEl.GetString()!;
    var args = body.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Object
        ? argsEl
        : default;
    if (!DesktopTools.TryExecute(tool, args, out var result, out var error))
    {
        return Results.Ok(new { ok = false, error, tool });
    }
    return Results.Ok(new { ok = true, result, tool });
});

app.Run("http://127.0.0.1:8765");
