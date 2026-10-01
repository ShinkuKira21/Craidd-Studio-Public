using System.Runtime.InteropServices;

internal static class InteropSmoke
{
    public static int Run()
    {
        try
        {
            if (NativeScalar.Add(20, 22) != 42) throw new Exception("scalar add failed");
            if (NativeScalar.Divide(20, 0) != int.MinValue || Marshal.GetLastPInvokeError() != 33)
                throw new Exception("C++ exception was not converted to EDOM at the C boundary");
            if (NativeScalar.Divide(20, 4) != 5 || Marshal.GetLastPInvokeError() != 0)
                throw new Exception("ordinary C++ divide failed");
            if (NativePacket.Score("Car", [1, 2, 3], 3) != 17)
                throw new Exception("packet score failed");
            if (NativePacket.Score("Café", [0, 3, 7], 3) != 32)
                throw new Exception("UTF-8 and embedded-zero score failed");

            IntPtr address = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                Marshal.WriteInt32(address, 41);
                if (NativeScalar.Bump(address) != 42 || Marshal.ReadInt32(address) != 42)
                    throw new Exception("C#-owned pointer was not modified by C++");
            }
            finally { Marshal.FreeHGlobal(address); }

            IntPtr handle = NativeScalar.NewCounter(7);
            if (handle == IntPtr.Zero) throw new OutOfMemoryException("C++ counter allocation failed");
            try
            {
                if (NativeScalar.ReadCounter(handle) != 7)
                    throw new Exception("C++-owned handle failed");
            }
            finally { NativeScalar.FreeCounter(handle); }

            Console.WriteLine("PASS: scalar, caught C++ throw, UTF-8 + byte buffer, and both IntPtr ownership paths");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"FAIL: {error}");
            return 1;
        }
    }
}
