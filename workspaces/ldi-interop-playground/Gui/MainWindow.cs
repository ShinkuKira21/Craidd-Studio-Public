using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

internal sealed class MainWindow : Window
{
    private readonly TextBox leftInput = new() { Text = "20", Width = 105 };
    private readonly TextBox rightInput = new() { Text = "22", Width = 105 };
    private readonly TextBox labelInput = new() { Text = "Café", Width = 170 };
    private readonly TextBox bytesInput = new() { Text = "0, 3, 7", Width = 170 };
    private readonly TextBlock addResult = Output();
    private readonly TextBlock divideResult = Output();
    private readonly TextBlock packetResult = Output();
    private readonly TextBlock pointerResult = Output();
    private readonly TextBlock status = Output();

    public MainWindow()
    {
        Title = "LDI Interop Playground · C# ↔ C++";
        Width = 780;
        Height = 760;
        MinWidth = 620;
        MinHeight = 550;

        Content = new ScrollViewer
        {
            Content = new StackPanel
            {
                Margin = new Thickness(24),
                Spacing = 14,
                Children =
                {
                    new TextBlock { Text = "C# GUI → unmanaged C++", FontSize = 26, FontWeight = FontWeight.SemiBold },
                    Note("Each button makes a real P/Invoke call. Blue/red LDI reproduces the marked calls in a second process; it does not copy B's result back into this GUI."),
                    Card("1 · Two integers", "Test blue alone first: B should stop at C++ function entry. Then add red on RED_ADD: B should land at that later line instead.",
                        Row(new TextBlock { Text = "Left", VerticalAlignment = VerticalAlignment.Center }, leftInput,
                            new TextBlock { Text = "Right", VerticalAlignment = VerticalAlignment.Center }, rightInput),
                        Action("Add in C++", Add), addResult),
                    Card("2 · A C++ throw, caught at its C boundary", "Set Right to 0. Blue alone enters the C++ function; an optional red on RED_THROW or RED_CATCH chooses a later landing. A calls C++ only after B finishes.",
                        Action("Divide in C++", Divide), divideResult),
                    Card("3 · UTF-8 + byte array", "Blue alone stops at C++ entry; optional red on RED_PACKET stops at strlen. The proxy captures .NET-marshalled bytes while A waits before the real export.",
                        Row(new TextBlock { Text = "Label", VerticalAlignment = VerticalAlignment.Center }, labelInput,
                            new TextBlock { Text = "Bytes (0–255)", VerticalAlignment = VerticalAlignment.Center }, bytesInput),
                        Action("Score packet in C++", ScorePacket),
                        Action("Try 4097-byte label · LDI should reject before B", ScoreTooLarge), packetResult),
                    Card("4 · IntPtr and ownership", "Normal run/debug only; do not set blue here. An address in A is meaningless in B. The first call passes a C#-allocated native int; the second receives a C++-owned handle and releases it.",
                        Action("C# pointer → C++ modifies it", BumpPointer),
                        Action("C++ handle → C# reads, then frees", ReadNativeHandle), pointerResult),
                    Card("What to watch", "B is a reproduction, not an attached debugger inside A. A's GUI can appear frozen during the hold. An uncaught C++ exception must never cross the C ABI; the divide example catches it and reports errno instead.",
                        status),
                },
            },
        };
        status.Text = "Choose a button. The simplest LDI check is Add → Divide by zero → Packet.";
    }

    private static TextBlock Output() => new() { TextWrapping = TextWrapping.Wrap, FontSize = 14 };

    private static TextBlock Note(string text) => new()
    {
        Text = text, TextWrapping = TextWrapping.Wrap, Foreground = Brushes.SlateGray,
    };

    private static Border Card(string title, string explanation, params Control[] controls)
    {
        var contents = new StackPanel { Spacing = 9 };
        contents.Children.Add(new TextBlock { Text = title, FontSize = 19, FontWeight = FontWeight.SemiBold });
        contents.Children.Add(Note(explanation));
        foreach (Control control in controls) contents.Children.Add(control);
        return new Border
        {
            BorderBrush = Brushes.SlateGray,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16),
            Child = contents,
        };
    }

    private static StackPanel Row(params Control[] controls)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        foreach (Control control in controls) row.Children.Add(control);
        return row;
    }

    private Button Action(string text, Action handler)
    {
        var button = new Button { Content = text, HorizontalAlignment = HorizontalAlignment.Left };
        button.Click += (_, _) =>
        {
            try { handler(); }
            catch (Exception error)
            {
                status.Text = $"{text}: {error.GetType().Name}: {error.Message}";
            }
        };
        return button;
    }

    private bool TryNumbers(out int left, out int right)
    {
        bool leftValid = int.TryParse(leftInput.Text, out left);
        bool rightValid = int.TryParse(rightInput.Text, out right);
        bool valid = leftValid && rightValid && Math.Abs((long)left) <= 1_000_000
            && Math.Abs((long)right) <= 1_000_000;
        if (!valid) status.Text = "Enter two integers between -1,000,000 and 1,000,000.";
        return valid;
    }

    private void Add()
    {
        if (!TryNumbers(out int left, out int right)) return;
        /* TEST 1 — put blue on the next call, with NO native red breakpoint.
           Expected: Gold LDI opens B at the top of demo_add in scalar.cpp.
           TEST 2 — keep blue, then add red on RED_ADD in scalar.cpp.
           Expected: B stops at the later red line instead of automatic entry.
           Try a blue condition of left == 20 && right == 22: changing either
           input should leave the call running normally without opening B.
           TEST 10 — while B is stopped, press B's White Stop: A should make
           its original call and remain available for the next blue hit.
           TEST 11 — Gold Stop stops both linked debuggers. Red without blue
           must never launch B's LDI reproduction. */
        int result = NativeScalar.Add(left, right); // BLUE_ADD
        addResult.Text = $"{left} + {right} = {result} (calculated by C++)";
        status.Text = "Add returned to C#. The GUI label changed after A executed its own native call.";
    }

    private void Divide()
    {
        if (!TryNumbers(out int numerator, out int denominator)) return;
        /* TEST 3 — move blue here, set Right=0, and leave B with NO red.
           Expected: B starts at demo_divide's entry; step through the throw
           and catch. After B returns, A runs its own call and shows errno=33.
           TEST 4 — add red on RED_THROW (or RED_CATCH) in scalar.cpp.
           Expected: B lands there directly. No C++ exception crosses into C#. */
        int result = NativeScalar.Divide(numerator, denominator); // BLUE_DIVIDE
        int nativeError = Marshal.GetLastPInvokeError();
        divideResult.Text = denominator == 0
            ? $"C++ threw std::domain_error, caught it at the export, then returned errno={nativeError}."
            : $"{numerator} / {denominator} = {result}; native errno={nativeError}.";
        status.Text = "The native exception stayed in C++; no C++ exception was thrown through P/Invoke.";
    }

    private bool TryPacket(out string label, out byte[] bytes)
    {
        label = labelInput.Text ?? "";
        var parts = (bytesInput.Text ?? "").Split([',', ' ', ';'], StringSplitOptions.RemoveEmptyEntries);
        bytes = new byte[parts.Length];
        if (parts.Length > 64)
        {
            status.Text = "Use up to 64 decimal bytes, separated by commas or spaces (for example: 0, 3, 7).";
            return false;
        }
        for (int index = 0; index < parts.Length; ++index)
        {
            if (byte.TryParse(parts[index], out bytes[index])) continue;
            status.Text = "Use decimal bytes from 0 to 255, separated by commas or spaces.";
            return false;
        }
        return true;
    }

    private void ScorePacket()
    {
        if (!TryPacket(out string label, out byte[] bytes)) return;
        /* TEST 5 — pair with Native · Packet LDI; put blue on the next line.
           NO red: B should stop at demo_score's entry in packet.cpp.
           TEST 6 — add red on RED_PACKET: B should stop at strlen instead.
           Default Café / 0,3,7 gives 32 after A's own call completes. */
        int result = NativePacket.Score(label, bytes, (nuint)bytes.Length); // BLUE_PACKET
        packetResult.Text = $"C++ score = {result}; label has {System.Text.Encoding.UTF8.GetByteCount(label)} UTF-8 bytes, payload has {bytes.Length} bytes.";
        status.Text = "A's own packet call returned. Try Café + 0,3,7 to see UTF-8 length and embedded zero handling.";
    }

    private void ScoreTooLarge()
    {
        string label = new('X', 4097);
        byte[] bytes = [0, 3, 7];
        /* TEST 7 — move blue here; B may have red or no red.
           Expected: the proxy reports a 4096-byte capture limit; B must NOT
           start. A remains held until Abandon B or Gold Stop. White Run is
           ordinary interop and should return normally. */
        int result = NativePacket.Score(label, bytes, (nuint)bytes.Length); // BLUE_TOO_LARGE
        packetResult.Text = $"Normal call score = {result}. With blue here, LDI should reject capture before B starts.";
        status.Text = "This normal native call is valid; only the bounded LDI reproduction rejects it.";
    }

    private void BumpPointer()
    {
        IntPtr address = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            Marshal.WriteInt32(address, 41);
            /* TEST 8 — try placing blue here. Expected: Craidd rejects this
               unsupported IntPtr signature. White Run still updates 41→42;
               the address belongs only to this process, not B. */
            int returned = NativeScalar.Bump(address); // POINTER_CALL: not LDI-reproducible.
            int now = Marshal.ReadInt32(address);
            pointerResult.Text = $"C# allocated address 0x{address.ToInt64():X}; C++ returned {returned}; C# reads {now}.";
            status.Text = "The pointer was valid only in A and was freed by C#. Copying its address into B would be wrong.";
        }
        finally { Marshal.FreeHGlobal(address); }
    }

    private void ReadNativeHandle()
    {
        /* TEST 9 — White Run/Debug only. C++ owns the returned allocation;
           C# reads it and always calls the matching native free export. A
           copied IntPtr would not recreate that allocation inside B. */
        IntPtr handle = NativeScalar.NewCounter(7);
        if (handle == IntPtr.Zero) throw new OutOfMemoryException("C++ could not create a counter");
        try
        {
            int value = NativeScalar.ReadCounter(handle);
            pointerResult.Text = $"C++ created opaque handle 0x{handle.ToInt64():X}; read value {value}.";
            status.Text = "C++ owns this allocation. C# calls the matching C++ free export in finally.";
        }
        finally { NativeScalar.FreeCounter(handle); }
    }
}

internal static class NativeScalar
{
    [DllImport("demo_scalar", EntryPoint = "demo_add", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Add(int left, int right);

    [DllImport("demo_scalar", EntryPoint = "demo_divide", CallingConvention = CallingConvention.Cdecl, SetLastError = true)]
    internal static extern int Divide(int numerator, int denominator);

    [DllImport("demo_scalar", EntryPoint = "demo_bump", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Bump(IntPtr address);

    [DllImport("demo_scalar", EntryPoint = "demo_new_counter", CallingConvention = CallingConvention.Cdecl)]
    internal static extern IntPtr NewCounter(int initial);

    [DllImport("demo_scalar", EntryPoint = "demo_read_counter", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int ReadCounter(IntPtr handle);

    [DllImport("demo_scalar", EntryPoint = "demo_free_counter", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void FreeCounter(IntPtr handle);
}

internal static class NativePacket
{
    // The typed proxy intentionally handles exactly one import from demo_packet.
    [DllImport("demo_packet", EntryPoint = "demo_score", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int Score([MarshalAs(UnmanagedType.LPUTF8Str)] string label, byte[] bytes, nuint count);
}
