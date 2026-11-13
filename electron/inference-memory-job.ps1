param(
  [Parameter(Mandatory=$true)][int]$WorkerPid,
  [Parameter(Mandatory=$true)][UInt64]$LimitBytes
)
$ErrorActionPreference = "Stop"
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class SyncInferenceJob {
    const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint JobObjectExtendedLimitInformation = 9;
    const uint WAIT_OBJECT_0 = 0;
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimitInformation {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
        public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimitInformation {
        public BasicLimitInformation BasicLimitInformation; public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessMemoryCountersEx {
        public uint cb; public uint PageFaultCount; public UIntPtr PeakWorkingSetSize; public UIntPtr WorkingSetSize;
        public UIntPtr QuotaPeakPagedPoolUsage; public UIntPtr QuotaPagedPoolUsage;
        public UIntPtr QuotaPeakNonPagedPoolUsage; public UIntPtr QuotaNonPagedPoolUsage;
        public UIntPtr PagefileUsage; public UIntPtr PeakPagefileUsage; public UIntPtr PrivateUsage;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, uint infoClass, ref ExtendedLimitInformation info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("psapi.dll", SetLastError=true)]
    static extern bool GetProcessMemoryInfo(IntPtr process, out ProcessMemoryCountersEx counters, uint size);
    static IntPtr jobHandle = IntPtr.Zero;
    static IntPtr processHandle = IntPtr.Zero;
    static volatile bool stopRequested = false;
    public static int Attach(int pid, ulong limitBytes, out string error) {
        error = "";
        jobHandle = CreateJobObject(IntPtr.Zero, null);
        if (jobHandle == IntPtr.Zero) { error = "Windows could not create the inference worker Job Object."; return 1; }
        ExtendedLimitInformation info = new ExtendedLimitInformation();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (limitBytes > 0) {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            info.ProcessMemoryLimit = new UIntPtr(limitBytes);
        }
        if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation)))) {
            error = "Windows could not configure the inference worker memory ceiling (Win32 " + Marshal.GetLastWin32Error() + ").";
            CloseHandle(jobHandle); jobHandle = IntPtr.Zero; return 2;
        }
        processHandle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (processHandle == IntPtr.Zero) {
            error = "Windows could not open the inference worker for Job Object assignment (Win32 " + Marshal.GetLastWin32Error() + ").";
            CloseHandle(jobHandle); jobHandle = IntPtr.Zero; return 3;
        }
        if (!AssignProcessToJobObject(jobHandle, processHandle)) {
            error = "Windows could not assign the inference worker to its Job Object (Win32 " + Marshal.GetLastWin32Error() + ").";
            CloseHandle(processHandle); processHandle = IntPtr.Zero;
            CloseHandle(jobHandle); jobHandle = IntPtr.Zero; return 4;
        }
        return 0;
    }
    public static void Monitor() {
        Thread inputThread = new Thread(() => {
            try { while (Console.ReadLine() != null) { stopRequested = true; break; } }
            catch { stopRequested = true; }
        });
        inputThread.IsBackground = true; inputThread.Start();
        while (!stopRequested) {
            if (WaitForSingleObject(processHandle, 1000) == WAIT_OBJECT_0) break;
            ProcessMemoryCountersEx counters;
            uint size = (uint)Marshal.SizeOf(typeof(ProcessMemoryCountersEx));
            if (GetProcessMemoryInfo(processHandle, out counters, size)) {
                Console.WriteLine("METRICS\t" + counters.WorkingSetSize.ToUInt64() + "\t" + counters.PrivateUsage.ToUInt64());
                Console.Out.Flush();
            }
        }
        if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); processHandle = IntPtr.Zero; }
        if (jobHandle != IntPtr.Zero) { CloseHandle(jobHandle); jobHandle = IntPtr.Zero; }
    }
}
'@
try {
  Add-Type -TypeDefinition $source -Language CSharp
  $errorMessage = ""
  $result = [SyncInferenceJob]::Attach($WorkerPid, $LimitBytes, [ref]$errorMessage)
  if ($result -ne 0) { [Console]::Out.WriteLine("ERROR: " + $errorMessage); exit 1 }
  [Console]::Out.WriteLine("READY")
  [Console]::Out.Flush()
  [SyncInferenceJob]::Monitor()
  exit 0
} catch {
  [Console]::Out.WriteLine("ERROR: " + $_.Exception.Message)
  exit 1
}
