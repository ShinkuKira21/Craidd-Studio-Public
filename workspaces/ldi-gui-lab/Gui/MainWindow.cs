using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Layout;

internal sealed class MainWindow : Window
{
    private readonly TextBox leftInput = new() { Text = "20" };
    private readonly TextBox rightInput = new() { Text = "22" };
    private readonly TextBlock resultLabel = new() { Text = "Result: not called yet", FontSize = 22 };

    public MainWindow()
    {
        Title = "LDI GUI Lab";
        Width = 440;
        Height = 360;
        CanResize = false;

        var calculate = new Button
        {
            Content = "Call C++",
            IsDefault = true,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        calculate.Click += Calculate;

        Content = new StackPanel
        {
            Margin = new Thickness(24),
            Spacing = 10,
            Children =
            {
                new TextBlock { Text = "C# GUI → C++ library", FontSize = 22 },
                new TextBlock { Text = "Left" },
                leftInput,
                new TextBlock { Text = "Right" },
                rightInput,
                calculate,
                resultLabel,
            },
        };
    }

    private void Calculate(object? sender, RoutedEventArgs args)
    {
        if (!int.TryParse(leftInput.Text, out int left) ||
            !int.TryParse(rightInput.Text, out int right) ||
            left < -1_000_000 || left > 1_000_000 ||
            right < -1_000_000 || right > 1_000_000)
        {
            resultLabel.Text = "Enter integers between ±1,000,000.";
            return;
        }

        int result = NativeMath.Add(left, right);
        resultLabel.Text = $"Result: {result}";
    }
}

internal static class NativeMath
{
    [DllImport("gui_math", EntryPoint = "gui_add", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Add(int left, int right);
}
