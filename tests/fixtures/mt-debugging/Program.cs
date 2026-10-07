using System;
using System.Threading;

class Program
{
    static readonly ManualResetEventSlim Gate = new(false);

    static void Worker()
    {
        int marker = 42;
        Gate.Wait(); // BREAK_HERE
        Console.WriteLine(marker);
    }

    static void Main()
    {
        var worker = new Thread(Worker) { Name = "probe worker" };
        worker.Start();
        Thread.Sleep(500);
        Gate.Set();
        worker.Join();
    }
}
