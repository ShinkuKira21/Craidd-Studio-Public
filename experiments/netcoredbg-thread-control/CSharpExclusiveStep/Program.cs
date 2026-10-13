using System.Threading;

if (args.Length is < 1 or > 2) throw new ArgumentException("Provide an output directory and optional lock scenario.");
string output = args[0];
Directory.CreateDirectory(output);
if (args.Length == 2 && args[1] == "lock")
{
    LockWait(output);
    return;
}
File.WriteAllText(Path.Combine(output, "worker-1.txt"), "0");
File.WriteAllText(Path.Combine(output, "worker-2.txt"), "0");

using var gate = new CountdownEvent(2);
Thread[] workers = Enumerable.Range(1, 2).Select(number => new Thread(() =>
{
    gate.Signal();
    gate.Wait();
    for (int beat = 1; beat <= 200; beat++)
    {
        int marker = number * 1000 + beat; // BREAK_EXCLUSIVE
        File.WriteAllText(Path.Combine(output, $"worker-{number}.txt"), beat.ToString());
        if (marker < 0) throw new InvalidOperationException();
        Thread.Sleep(25);
    }
}) { Name = $"exclusive worker {number}" }).ToArray();

foreach (Thread worker in workers) worker.Start();
foreach (Thread worker in workers) worker.Join();

static void LockWait(string output)
{
    object monitor = new();
    using var ownerEntered = new ManualResetEventSlim(false);
    string releasePath = Path.Combine(output, "release-owner");
    string completedPath = Path.Combine(output, "waiter-complete");
    var owner = new Thread(() =>
    {
        lock (monitor)
        {
            ownerEntered.Set();
            while (!File.Exists(releasePath)) Thread.Sleep(20);
        }
    }) { Name = "lock owner" };
    var waiter = new Thread(() =>
    {
        ownerEntered.Wait();
        int marker = 1; // BREAK_LOCK
        lock (monitor)
        {
            File.WriteAllText(completedPath, marker.ToString());
        }
    }) { Name = "lock waiter" };
    owner.Start();
    waiter.Start();
    owner.Join();
    waiter.Join();
}
