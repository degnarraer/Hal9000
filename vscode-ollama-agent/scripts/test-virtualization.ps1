$ErrorActionPreference = 'Stop'

function Get-SystemInfoMap {
  $map = @{}
  try {
    $lines = systeminfo.exe
    foreach ($line in $lines) {
      $index = $line.IndexOf(':')
      if ($index -lt 0) { continue }
      $key = $line.Substring(0, $index).Trim()
      $value = $line.Substring($index + 1).Trim()
      if ($key) { $map[$key] = $value }
    }
  } catch {
    Write-Host "[warning] Could not run systeminfo.exe: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  return $map
}

function Test-VirtualizationSupport {
  $hypervisorPresent = $false
  try {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem
    $hypervisorPresent = [bool]$computer.HypervisorPresent
  } catch {
    Write-Host "[warning] Could not query Win32_ComputerSystem: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  $info = Get-SystemInfoMap

  $firmwareVirtualization = $info['Virtualization Enabled In Firmware']
  $vmMonitorMode = $info['VM Monitor Mode Extensions']
  $slat = $info['Second Level Address Translation']
  $dep = $info['Data Execution Prevention Available']
  $couldInspect = $hypervisorPresent -or $firmwareVirtualization -or $vmMonitorMode -or $slat -or $dep

  Write-Host "[info] Hypervisor present: $hypervisorPresent"
  if ($firmwareVirtualization) { Write-Host "[info] Virtualization enabled in firmware: $firmwareVirtualization" }
  if ($vmMonitorMode) { Write-Host "[info] VM monitor mode extensions: $vmMonitorMode" }
  if ($slat) { Write-Host "[info] Second level address translation: $slat" }
  if ($dep) { Write-Host "[info] Data execution prevention: $dep" }

  $firmwareOk = $firmwareVirtualization -match '^Yes$'
  $hypervOk = $hypervisorPresent -or $firmwareOk

  if (-not $couldInspect) {
    Write-Host "[warning] Virtualization support could not be inspected from this shell. Continuing without blocking Docker startup." -ForegroundColor Yellow
    return $true
  }

  if (-not $hypervOk) {
    Write-Host ""
    Write-Host "[blocked] Docker Desktop cannot start because virtualization support is not available to Windows." -ForegroundColor Red
    Write-Host "Enable CPU virtualization in BIOS/UEFI, then enable Windows virtualization features:"
    Write-Host "  - Virtual Machine Platform"
    Write-Host "  - Windows Hypervisor Platform"
    Write-Host "  - Windows Subsystem for Linux"
    Write-Host ""
    Write-Host "After changing BIOS or Windows features, reboot before starting Docker Desktop again."
    return $false
  }

  Write-Host "[ok] Virtualization support appears available"
  return $true
}

if (Test-VirtualizationSupport) {
  exit 0
}

exit 1
