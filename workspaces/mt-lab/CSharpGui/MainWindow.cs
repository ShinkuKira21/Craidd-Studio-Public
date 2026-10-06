using System.Runtime.InteropServices;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Threading;

internal sealed class MainWindow : Window
{
    private readonly TextBlock status = new() { Text = "Choose a variant.", TextWrapping = Avalonia.Media.TextWrapping.Wrap };
    private ManualResetEventSlim? basicGate;
    private int runNumber;

    public MainWindow()
    {
        Title = "C# Multi-Thread Lab";
        Width = 550;
        Height = 420;
        Content = new ScrollViewer { Content = new StackPanel
        {
            Margin = new Thickness(22), Spacing = 10,
            Children =
            {
                new TextBlock { Text = "C# Multi-Thread Lab", FontSize = 22 },
                new TextBlock { Text = "Choose a scenario, then inspect its named workers in Craidd. The GUI remains responsive." },
                MakeButton("1 · Start two waiting workers", StartBasic),
                MakeButton("1 · Release workers", ReleaseBasic),
                MakeButton("2 · Launch short worker burst", StartBurst),
                MakeButton("3 · Worker calls C++ library (LDI gate)", StartNativeCall),
                new TextBlock { Text = "Variant 3 is the later MT + LDI acceptance gate. The C++ library itself creates no threads.", TextWrapping = Avalonia.Media.TextWrapping.Wrap },
                status,
            },
        }};
    }

    private static Button MakeButton(string label, Action action)
    {
        var button = new Button { Content = label, HorizontalAlignment = HorizontalAlignment.Stretch };
        button.Click += (_, _) => action();
        return button;
    }

    private void Report(string message) => Dispatcher.UIThread.Post(() => status.Text = message);

    private void StartBasic()
    {
        basicGate?.Set();
        var gate = new ManualResetEventSlim(false);
        basicGate = gate;
        int run = Interlocked.Increment(ref runNumber);
        for (int number = 1; number <= 2; number++)
        {
            int workerNumber = number;
            var worker = new Thread(() =>
            {
                gate.Wait();
                int marker = run * 100 + workerNumber; // BREAK_GUI_BASIC
                for (int beat = 0; beat < 30; beat++)
                {
                    int sample = marker + beat;
                    if (beat % 10 == 0) Report($"Worker {workerNumber} sampled {sample}");
                    Thread.Sleep(400);
                }
                Report($"Worker {workerNumber} completed.");
            }) { IsBackground = true, Name = $"cs gui {run}-{workerNumber}" };
            worker.Start();
        }
        Report($"Run {run}: two workers are waiting. Click Release workers.");
    }

    private void ReleaseBasic()
    {
        basicGate?.Set();
        Report("Released the waiting workers.");
    }

    private void StartBurst()
    {
        int run = Interlocked.Increment(ref runNumber);
        for (int number = 1; number <= 6; number++)
        {
            int workerNumber = number;
            var worker = new Thread(() =>
            {
                int marker = run * 100 + workerNumber; // BREAK_GUI_BURST
                Thread.Sleep(700 + workerNumber * 250);
                Report($"Short worker {workerNumber} completed: {marker}");
            }) { IsBackground = true, Name = $"cs short {run}-{number}" };
            worker.Start();
        }
        Report($"Run {run}: six short workers launched.");
    }

    private void StartNativeCall()
    {
        int run = Interlocked.Increment(ref runNumber);
        var worker = new Thread(() =>
        {
            try
            {
                int left = 20;
                int right = 22;
                int result = NativeMath.Add(left, right); // BREAK_GUI_LDI
                Report($"Run {run}: C++ returned {result} from the C# worker.");
            }
            catch (Exception error)
            {
                Report($"Native call failed: {error.Message}");
            }
        }) { IsBackground = true, Name = $"cs native {run}" };
        worker.Start();
        Report($"Run {run}: native-call worker started.");
    }
}

internal static class NativeMath
{
    [DllImport("mt_native", EntryPoint = "mt_add", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Add(int left, int right);
}
