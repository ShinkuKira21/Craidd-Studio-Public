using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

internal static class Native
{
    [DllImport("gate_native", EntryPoint = "gate_add", CallingConvention = CallingConvention.Cdecl, SetLastError = true)]
    internal static extern int Add(int left, int right);
    [DllImport("gate_native", EntryPoint = "gate_call_count", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int CallCount();
    [DllImport("gate_measure_native", EntryPoint = "gate_measure", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Measure([MarshalAs(UnmanagedType.LPUTF8Str)] string label, byte[] bytes, nuint count);
}

internal static class Program
{
    private static int producers;
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Produce(string value) { producers++; return int.Parse(value); }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Run(string[] args)
    {
        int left = Produce(args[0]);
        int right = Produce(args[1]);
        int before = Native.CallCount();
        int result = Native.Add(left, right); // BLUE_STOP
        int savedError = Marshal.GetLastPInvokeError();
        int after = Native.CallCount();
        Console.WriteLine($"HOST result={result} errno={savedError} before={before} after={after} producers={producers}"); // AFTER_CALL
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Unsupported(string[] args)
    {
        int result = Native.Add(Produce(args[0]), Produce(args[1])); // UNSUPPORTED_STOP
        Console.WriteLine($"HOST result={result} producers={producers}");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Conditional()
    {
        for (int i = 0; i < 12; i++)
        {
            int left = i;
            int right = 1;
            int result = Native.Add(left, right); // BLUE_CONDITIONAL
            if (result != i + 1) throw new Exception("Unexpected native result");
        }
        Console.WriteLine("HOST conditional calls=12");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void InterposerRepeat()
    {
        string label = "Car";
        byte[] bytes = [1, 2, 3];
        for (int i = 0; i < 12; i++)
        {
            int result = Native.Measure(label, bytes, (nuint)bytes.Length); // BUFFER_CONDITIONAL
            if (result != 284) throw new Exception("Unexpected interposer result");
        }
        Console.WriteLine("HOST interposer calls=12");
    }

    private static void Main(string[] args)
    {
        Console.WriteLine($"HOST pid={Environment.ProcessId}");
        if (args.Length == 1 && args[0] == "interposer")
        {
            string label = "Car";
            byte[] bytes = [1, 2, 3];
            int result = Native.Measure(label, bytes, (nuint)bytes.Length); // BUFFER_BLUE
            Console.WriteLine($"HOST interposer result={result}");
        }
        else if (args.Length == 1 && args[0] == "interposer-unsupported")
        {
            string label = new string('X', 4097);
            byte[] bytes = [1, 2, 3];
            int result = Native.Measure(label, bytes, (nuint)bytes.Length); // BUFFER_UNSUPPORTED_BLUE
            Console.WriteLine($"HOST unsupported result={result}");
        }
        else if (args.Length == 1 && args[0] == "conditional") Conditional();
        else if (args.Length == 1 && args[0] == "interposer-repeat") InterposerRepeat();
        else if (args.Length == 3 && args[2] == "unsupported") Unsupported(args);
        else Run(args);
    }
}
