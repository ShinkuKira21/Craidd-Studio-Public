using PolyglotLab.Core;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options => options.AddPolicy("local-client", policy => policy
    .WithOrigins("http://127.0.0.1:1535", "http://localhost:1535",
        "http://tauri.localhost", "tauri://localhost")
    .AllowAnyHeader()
    .AllowAnyMethod()));
var dataset = builder.Configuration["dataset"] ?? "small";
builder.Services.AddSingleton(new WorkCatalog(dataset));

var app = builder.Build();
app.UseCors("local-client");

app.MapGet("/", () => Results.Redirect("/api/health"));
app.MapGet("/api/health", (IHostEnvironment environment) => Results.Ok(new
{
    service = "Polyglot Lab API",
    environment = environment.EnvironmentName,
    dataset,
    timeUtc = DateTimeOffset.UtcNow,
}));
app.MapGet("/api/work", (WorkCatalog catalog) => Results.Ok(catalog.All()));
app.MapPost("/api/work", (CreateWorkRequest request, WorkCatalog catalog) =>
{
    try
    {
        var item = catalog.Add(request.Title);
        return Results.Created($"/api/work/{item.Id}", item);
    }
    catch (ArgumentException error)
    {
        return Results.BadRequest(new { error = error.Message });
    }
});
app.MapPost("/api/work/{id:int}/complete", (int id, WorkCatalog catalog) =>
{
    var item = catalog.Complete(id);
    return item is null ? Results.NotFound() : Results.Ok(item);
});

#if DEBUG
app.MapGet("/api/debug", () => Results.Ok(new { message = "This endpoint is compiled only in Debug." }));
#endif

app.Run();

internal sealed record CreateWorkRequest(string? Title);
