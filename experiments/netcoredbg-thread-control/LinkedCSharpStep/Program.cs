using System.Runtime.InteropServices;
using System.Threading;

if (args.Length != 2 || args[0] is not ("c" or "cpp"))
    throw new ArgumentException("Usage: LinkedCSharpStep c|cpp output-directory");
string language = args[0];
string output = args[1];
Directory.CreateDirectory(output);
for (int number = 1; number <= 2; number++)
    File.WriteAllText(Path.Combine(output, $"worker-{number}.txt"), "0");

using var gate = new CountdownEvent(2);
Thread[] workers = Enumerable.Range(1, 2).Select(number => new Thread(() =>
{
    gate.Signal();
    gate.Wait();
    for (int beat = 1; beat <= 40; beat++)
    {
        int marker = number * 1000 + beat; // BREAK_MANAGED
        int zero = 0;
        if (language == "c")
        {
            int value = Native.StepC(marker, zero); // BLUE_C_CALL
            File.WriteAllText(Path.Combine(output, $"worker-{number}.txt"), value.ToString());
        }
        else
        {
            int value = Native.StepCpp(marker, zero); // BLUE_CPP_CALL
            File.WriteAllText(Path.Combine(output, $"worker-{number}.txt"), value.ToString());
        }
        Thread.Sleep(50);
    }
}) { Name = $"managed linked {number}" }).ToArray();
foreach (Thread worker in workers) worker.Start();
foreach (Thread worker in workers) worker.Join();

internal static class Native
{
    [DllImport("step_c", EntryPoint = "step_add_c", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int StepC(int left, int right);

    [DllImport("step_cpp", EntryPoint = "step_add_cpp", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int StepCpp(int left, int right);
}
