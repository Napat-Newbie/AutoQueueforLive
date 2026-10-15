$code = @"
using System;
using System.Runtime.InteropServices;
public class WinSleep {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
Add-Type -TypeDefinition $code
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_DISPLAY_REQUIRED (0x00000002)
while ($true) {
    [WinSleep]::SetThreadExecutionState(0x80000003)
    Start-Sleep -Seconds 60
}