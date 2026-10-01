using System.Reflection;
using System.Runtime.InteropServices;

// Loaded by DOTNET_STARTUP_HOOKS only for a verified Gold LDI session.
// It redirects one P/Invoke library in the entry assembly to Craidd's typed
// proxy; all other assembly/native loading stays under the application's control.
internal static class StartupHook
{
    private static bool installed;

    public static void Initialize()
    {
        string? target = Environment.GetEnvironmentVariable("LDI_MANAGED_ASSEMBLY");
        string? library = Environment.GetEnvironmentVariable("LDI_MANAGED_LIBRARY");
        string? methodName = Environment.GetEnvironmentVariable("LDI_MANAGED_METHOD");
        string? proxy = Environment.GetEnvironmentVariable("LDI_PROXY_LIBRARY");
        string? ready = Environment.GetEnvironmentVariable("LDI_HOOK_READY");
        if (target is null || library is null || methodName is null || proxy is null || ready is null)
            throw new InvalidOperationException("LDI startup hook configuration is incomplete");

        void Install(Assembly assembly)
        {
            if (installed || !string.Equals(assembly.Location, target, StringComparison.Ordinal)) return;
            var imports = assembly.GetTypes()
                .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
                .Select(method => (method, import: method.GetCustomAttribute<DllImportAttribute>()))
                .Where(item => item.import?.Value == library).ToArray();
            if (imports.Length != 1 || imports[0].method.Name != methodName ||
                imports[0].method.ReturnType != typeof(int) ||
                imports[0].import!.CallingConvention != CallingConvention.Cdecl)
                throw new InvalidOperationException("LDI proxy needs exactly one verified DllImport for this library");
            var parameters = imports[0].method.GetParameters();
            if (parameters.Length != 3 || parameters[0].ParameterType != typeof(string) ||
                parameters[0].GetCustomAttribute<MarshalAsAttribute>()?.Value != UnmanagedType.LPUTF8Str ||
                parameters[1].ParameterType != typeof(byte[]) || parameters[2].ParameterType != typeof(nuint))
                throw new InvalidOperationException("LDI proxy signature is not UTF-8 string, byte[], nuint");
            NativeLibrary.SetDllImportResolver(assembly, (name, _, _) =>
                name == library ? NativeLibrary.Load(proxy) : IntPtr.Zero);
            installed = true;
            File.WriteAllText(ready, Environment.ProcessId.ToString());
        }

        AppDomain.CurrentDomain.AssemblyLoad += (_, args) => Install(args.LoadedAssembly);
        foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies()) Install(assembly);
    }
}
