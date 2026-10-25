$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    if ($request.nonce -notmatch '^[0-9a-f]{64}$') {
        throw 'invalid request'
    }

    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class StorageBucketEngineHost {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Startup {
        public int cb;
        public string reserved, desktop, title;
        public uint x, y, width, height, charsX, charsY, fill, flags;
        public ushort show, reservedSize;
        public IntPtr reservedPointer, input, output, error;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupEx {
        public Startup basic;
        public IntPtr attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        public IntPtr process, thread;
        public uint pid, tid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Security {
        public int size;
        public IntPtr descriptor;
        public int inherit;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit {
        public long processTime, jobTime;
        public uint flags;
        public UIntPtr minimum, maximum;
        public uint activeLimit;
        public UIntPtr affinity;
        public uint priority, scheduling;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Io {
        public ulong a, b, c, d, e, f;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Limits {
        public BasicLimit basic;
        public Io io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long user, kernel, periodUser, periodKernel;
        public uint faults, total, active, terminated;
    }

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(
        IntPtr job, int kind, ref Limits value, uint size);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(
        IntPtr job, int kind, out Accounting value, uint size, IntPtr returned);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CreatePipe(
        out IntPtr read, out IntPtr write, ref Security security, uint size);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    static extern IntPtr GetStdHandle(int kind);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool DuplicateHandle(
        IntPtr fromProcess, IntPtr from, IntPtr toProcess,
        out IntPtr to, uint access, bool inherit, uint flags);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool InitializeProcThreadAttributeList(
        IntPtr list, int count, uint flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool UpdateProcThreadAttribute(
        IntPtr list, uint flags, IntPtr attribute, IntPtr value,
        IntPtr size, IntPtr previous, IntPtr returned);

    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcessW(
        string app, StringBuilder command, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags,
        IntPtr environment, string cwd, ref StartupEx startup,
        out ProcessInfo process);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess(IntPtr process, uint code);

    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    public sealed class Result {
        public uint ExitCode;
        public bool Canceled, TimedOut, InputFailed;
    }

    static void Check(bool value) {
        if (!value) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    static string Quote(string value) {
        var text = new StringBuilder("\"");
        int slashes = 0;

        foreach (char c in value) {
            if (c == '\\') {
                slashes++;
                continue;
            }

            if (c == '"') {
                text.Append('\\', slashes * 2 + 1).Append('"');
            } else {
                text.Append('\\', slashes).Append(c);
            }

            slashes = 0;
        }

        return text.Append('\\', slashes * 2).Append('"').ToString();
    }

    public static Result Run(
        string executable, string[] args, string cwd, byte[] input, int timeout
    ) {
        IntPtr job = IntPtr.Zero, read = IntPtr.Zero, write = IntPtr.Zero;
        IntPtr stdout = IntPtr.Zero, stderr = IntPtr.Zero;
        IntPtr list = IntPtr.Zero, handles = IntPtr.Zero;

        var process = new ProcessInfo();
        bool assigned = false, listReady = false;

        try {
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);

            var limits = new Limits();
            limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(
                job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits))));

            var security = new Security {
                size = Marshal.SizeOf(typeof(Security)),
                inherit = 1
            };

            Check(CreatePipe(out read, out write, ref security, 0));
            Check(SetHandleInformation(write, 1, 0));

            IntPtr self = GetCurrentProcess();
            Check(DuplicateHandle(
                self, GetStdHandle(-11), self, out stdout, 0, true, 2));
            Check(DuplicateHandle(
                self, GetStdHandle(-12), self, out stderr, 0, true, 2));

            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);

            list = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(list, 1, 0, ref size));
            listReady = true;

            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handles, 0, read);
            Marshal.WriteIntPtr(handles, IntPtr.Size, stdout);
            Marshal.WriteIntPtr(handles, IntPtr.Size * 2, stderr);

            Check(UpdateProcThreadAttribute(
                list, 0, new IntPtr(0x20002), handles,
                new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));

            var startup = new StartupEx();
            startup.basic.cb = Marshal.SizeOf(typeof(StartupEx));
            startup.basic.flags = 0x100; // STARTF_USESTDHANDLES
            startup.basic.input = read;
            startup.basic.output = stdout;
            startup.basic.error = stderr;
            startup.attributes = list;

            var command = new StringBuilder(Quote(executable));
            foreach (string arg in args) {
                command.Append(' ').Append(Quote(arg));
            }

            // CREATE_SUSPENDED | CREATE_NO_WINDOW |
            // EXTENDED_STARTUPINFO_PRESENT
            Check(CreateProcessW(
                executable, command, IntPtr.Zero, IntPtr.Zero, true,
                0x08080004, IntPtr.Zero, cwd, ref startup, out process));

            Check(AssignProcessToJobObject(job, process.process));
            assigned = true;

            CloseHandle(read);
            read = IntPtr.Zero;
            CloseHandle(stdout);
            stdout = IntPtr.Zero;
            CloseHandle(stderr);
            stderr = IntPtr.Zero;

            int canceled = 0, inputFailed = 0;

            Task.Run(() => {
                try {
                    Console.In.ReadLine();
                } finally {
                    Interlocked.Exchange(ref canceled, 1);
                }
            });

            IntPtr inputHandle = write;
            write = IntPtr.Zero;

            Task writer = Task.Run(() => {
                try {
                    using (var safe = new SafeFileHandle(inputHandle, true))
                    using (var stream = new FileStream(safe, FileAccess.Write)) {
                        stream.Write(input, 0, input.Length);
                    }
                } catch {
                    Interlocked.Exchange(ref inputFailed, 1);
                }
            });

            if (ResumeThread(process.thread) == uint.MaxValue) {
                Check(false);
            }

            var watch = System.Diagnostics.Stopwatch.StartNew();
            bool stopped = false, timedOut = false, wasCanceled = false;

            for (;;) {
                Accounting accounting;
                Check(QueryInformationJobObject(
                    job, 1, out accounting,
                    (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));

                if (accounting.active == 0) {
                    break;
                }

                if (!stopped && (
                    Volatile.Read(ref canceled) != 0 ||
                    watch.ElapsedMilliseconds >= timeout
                )) {
                    wasCanceled = Volatile.Read(ref canceled) != 0;
                    timedOut = !wasCanceled;

                    Check(TerminateJobObject(job, 1));
                    stopped = true;
                }

                Thread.Sleep(10);
            }

            writer.Wait();

            uint exitCode;
            Check(GetExitCodeProcess(process.process, out exitCode));

            return new Result {
                ExitCode = exitCode,
                Canceled = wasCanceled,
                TimedOut = timedOut,
                InputFailed = Volatile.Read(ref inputFailed) != 0
            };
        } finally {
            if (process.process != IntPtr.Zero && !assigned) {
                TerminateProcess(process.process, 1);
                WaitForSingleObject(process.process, 5000);
            }

            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
            if (process.process != IntPtr.Zero) CloseHandle(process.process);

            foreach (IntPtr handle in new [] { read, write, stdout, stderr }) {
                if (handle != IntPtr.Zero) CloseHandle(handle);
            }

            if (listReady) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
        }
    }
}
'@

    $result = [StorageBucketEngineHost]::Run(
        [string]$request.executable,
        [string[]]$request.arguments,
        [string]$request.cwd,
        [Convert]::FromBase64String([string]$request.input),
        [int]$request.timeoutMs
    )

    $proof = @{
        exitCode    = $result.ExitCode
        canceled    = $result.Canceled
        timedOut    = $result.TimedOut
        inputFailed = $result.InputFailed
        quiescent   = $true
    } | ConvertTo-Json -Compress

    [Console]::Out.WriteLine()
    [Console]::Out.WriteLine("SB_ENGINE_" + $request.nonce + ":" + $proof)
    exit 0
}
catch {
    [Console]::Error.WriteLine('ENGINE_HOST_FAILED')
    exit 125
}