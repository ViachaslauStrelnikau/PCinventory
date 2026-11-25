using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class ExecutableManifest
{
    private static readonly IntPtr ManifestType = new IntPtr(24);
    private static readonly IntPtr ProcessManifest = new IntPtr(1);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string path, bool deleteExistingResources);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResource(
        IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr update, bool discard);

    public static void Apply(string executable, string manifest)
    {
        byte[] bytes = File.ReadAllBytes(manifest);
        IntPtr update = BeginUpdateResource(executable, false);
        if (update == IntPtr.Zero)
            throw new Win32Exception();

        if (!UpdateResource(update, ManifestType, ProcessManifest, 0, bytes, (uint)bytes.Length))
        {
            int error = Marshal.GetLastWin32Error();
            EndUpdateResource(update, true);
            throw new Win32Exception(error);
        }

        if (!EndUpdateResource(update, false))
            throw new Win32Exception();
    }
}
