using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Security.AccessControl;
using System.Security.Principal;

// The parent owns the only handle. Cancellation closes it and kills this job's
// worker and descendants, including detached children; breakaway is not enabled.
public sealed class ZJProcessGroup : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(ref SecurityAttributes security, string name);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr handle;
    public ZJProcessGroup(string name, string workerSid) {
        var worker = new SecurityIdentifier(workerSid).Value;
        var owner = WindowsIdentity.GetCurrent().User.Value;
        var descriptor = new RawSecurityDescriptor("D:P(A;;GA;;;"+owner+")(A;;0x1;;;"+worker+")S:(ML;;NW;;;ME)");
        var bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes,0);
        var memory = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes,0,memory,bytes.Length);
            var security = new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor=memory, Inherit=0 };
            handle=CreateJobObject(ref security,name);
        } finally { Marshal.FreeHGlobal(memory); }
        if(handle==IntPtr.Zero) throw new Win32Exception();
        var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE
        if(!SetInformationJobObject(handle,9,ref limits,(uint)Marshal.SizeOf(limits))) {
            var error=new Win32Exception(); CloseHandle(handle); handle=IntPtr.Zero; throw error;
        }
    }
    public static void Attach(string name) {
        var job=OpenJobObject(1,false,name); // ASSIGN_PROCESS only, no termination rights
        if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenJobObject failed");
        try { if(!AssignProcessToJobObject(job,Process.GetCurrentProcess().Handle)) throw new Win32Exception(Marshal.GetLastWin32Error(),"AssignProcessToJobObject failed"); }
        finally { CloseHandle(job); }
    }
    public void Reap() {
        if(handle==IntPtr.Zero) return;
        if(!TerminateJobObject(handle,1)) throw new Win32Exception();
        for(var i=0;i<100;i++) {
            Accounting info;
            if(!QueryInformationJobObject(handle,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Win32Exception();
            if(info.ActiveProcesses==0) return;
            Thread.Sleep(50);
        }
        throw new InvalidOperationException("PROCESS_TREE_NOT_REAPED");
    }
    public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
}
