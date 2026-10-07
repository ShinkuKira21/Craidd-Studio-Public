using System.Collections.Concurrent;
using System.Threading;

string variant = args.FirstOrDefault() ?? "basic";
Console.WriteLine($"C# MT Console · {variant}");

switch (variant)
{
    case "basic": Basic(); break;
    case "burst": Burst(); break;
    case "handoff": Handoff(); break;
    default: throw new ArgumentException("Choose basic, burst, or handoff.");
}

static void Basic()
{
    using var start = new ManualResetEventSlim(false);
    Thread[] workers = Enumerable.Range(1, 2).Select(number => new Thread(() =>
    {
        start.Wait();
        int marker = number * 10; // BREAK_CS_BASIC
        for (int beat = 0; beat < 30; beat++)
        {
            int sample = marker + beat;
            if (beat % 10 == 0) Console.WriteLine($"worker {number}: {sample}");
            Thread.Sleep(400);
        }
    }) { Name = $"cs worker {number}" }).ToArray();

    foreach (Thread worker in workers) worker.Start();
    start.Set();
    foreach (Thread worker in workers) worker.Join();
}

static void Burst()
{
    var workers = new List<Thread>();
    for (int number = 1; number <= 10; number++)
    {
        int taskNumber = number;
        var worker = new Thread(() =>
        {
            int marker = taskNumber * 100; // BREAK_CS_BURST
            Thread.Sleep(1500);
            Console.WriteLine($"short worker {taskNumber}: {marker}");
        }) { Name = $"cs short {taskNumber}" };
        workers.Add(worker);
        worker.Start();
        Thread.Sleep(500);
    }
    foreach (Thread worker in workers) worker.Join();
}

static void Handoff()
{
    using var jobs = new BlockingCollection<int>();
    var consumer = new Thread(() =>
    {
        foreach (int job in jobs.GetConsumingEnumerable())
        {
            int result = job * 3; // BREAK_CS_HANDOFF
            Console.WriteLine($"consumed {job}: {result}");
            Thread.Sleep(350);
        }
    }) { Name = "cs consumer" };
    var producer = new Thread(() =>
    {
        for (int job = 1; job <= 12; job++)
        {
            jobs.Add(job);
            Thread.Sleep(250);
        }
        jobs.CompleteAdding();
    }) { Name = "cs producer" };
    consumer.Start();
    producer.Start();
    producer.Join();
    consumer.Join();
}
