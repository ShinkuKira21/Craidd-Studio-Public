using System;
using System.Threading;

internal static class Program
{
    private static readonly ManualResetEventSlim Start = new(false);
    private static readonly ManualResetEventSlim Finish = new(false);

    private static void Worker(int workerId)
    {
        Start.Wait();
        int workMarker = workerId * 10;
        int heartbeat = 0; // BREAK_WORKER
        while (!Finish.Wait(200))
        {
            heartbeat += workMarker;
        }
        Console.WriteLine($"worker {workerId} finished after {heartbeat} units");
    }

    private static void ShortTask(int number)
    {
        int shortMarker = number * 100; // BREAK_SHORT
        Thread.Sleep(1500);
        Console.WriteLine($"short worker {number} completed ({shortMarker})");
    }

    private static void Main()
    {
        var first = new Thread(() => Worker(1)) { Name = "worker one" };
        var second = new Thread(() => Worker(2)) { Name = "worker two" };
        first.Start();
        second.Start();
        Start.Set();

        Console.WriteLine("Thread lab: two long-lived workers and repeated short-lived workers.");
        // Count completed rounds so time spent at a debugger stop does not
        // use up the lab's lifetime before Continue is pressed.
        for (int nextShort = 1; nextShort <= 20; nextShort++)
        {
            int taskNumber = nextShort;
            var shortWorker = new Thread(() => ShortTask(taskNumber))
                { Name = $"short worker {taskNumber}" };
            shortWorker.Start();
            Thread.Sleep(3000);
        }

        Finish.Set();
        first.Join();
        second.Join();
        Console.WriteLine("Thread lab complete. Restart Debug to repeat.");
    }
}
