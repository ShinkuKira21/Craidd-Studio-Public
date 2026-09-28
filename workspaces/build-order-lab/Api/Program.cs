using System.Runtime.InteropServices;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins("http://127.0.0.1:1545", "http://localhost:1545", "http://tauri.localhost", "tauri://localhost")
    .AllowAnyHeader().AllowAnyMethod()));
var app = builder.Build();
app.UseCors();

// Readiness deliberately calls the native library. A listening API without
// its installed library is NOT ready, so Linked Run/Debug must keep waiting.
app.MapGet("/health", () => new { ready = true, value = NativeMath.Add(20, 22), source = "C++ → C# → Tauri" });
app.MapGet("/sum/{left:int}/{right:int}", (int left, int right) => new { value = NativeMath.Add(left, right) });
app.Run();

internal static class NativeMath
{
    [DllImport("order_math", EntryPoint = "order_add", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Add(int left, int right);
}
