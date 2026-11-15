$ErrorActionPreference = "Stop"

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

$ProjectFolder = "C:\Users\xande\Documents\GitHub\goodnotes-pdf-prep"
$AppUrl = "http://127.0.0.1:5173"
$Port = 5173

# Use a separate Edge profile so this app gets its own process.
$ProfileFolder = Join-Path $env:LOCALAPPDATA "GoodnotesPdfPrep\EdgeProfile"

# Log Vite output here instead of displaying a terminal.
$LogFolder = Join-Path $env:LOCALAPPDATA "GoodnotesPdfPrep"
$LogFile = Join-Path $LogFolder "vite.log"

New-Item -ItemType Directory -Force -Path $LogFolder | Out-Null
New-Item -ItemType Directory -Force -Path $ProfileFolder | Out-Null

# ------------------------------------------------------------
# Locate Microsoft Edge
# ------------------------------------------------------------

$EdgeCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)

$EdgePath = $EdgeCandidates |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

if (-not $EdgePath) {
    Add-Type -AssemblyName PresentationFramework

    [System.Windows.MessageBox]::Show(
        "Microsoft Edge could not be found.",
        "Goodnotes PDF Prep",
        "OK",
        "Error"
    ) | Out-Null

    exit 1
}

# ------------------------------------------------------------
# Check whether the app is already running
# ------------------------------------------------------------

$ExistingConnection = Get-NetTCPConnection `
    -LocalPort $Port `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($ExistingConnection) {
    # The server is already running. Open the app without starting another.
    Start-Process `
        -FilePath $EdgePath `
        -ArgumentList @(
            "--app=$AppUrl",
            "--user-data-dir=$ProfileFolder",
            "--no-first-run"
        )

    exit 0
}

# ------------------------------------------------------------
# Start Vite in the background
# ------------------------------------------------------------

Set-Location $ProjectFolder

$ServerProcess = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @(
        "/c",
        "npm.cmd run dev -- --host 127.0.0.1 --port $Port --strictPort > `"$LogFile`" 2>&1"
    ) `
    -WorkingDirectory $ProjectFolder `
    -WindowStyle Hidden `
    -PassThru

try {
    # --------------------------------------------------------
    # Wait up to 30 seconds for Vite to become available
    # --------------------------------------------------------

    $ServerReady = $false

    for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
        Start-Sleep -Milliseconds 500

        if ($ServerProcess.HasExited) {
            throw "The Vite server stopped before the app was ready."
        }

        try {
            $Response = Invoke-WebRequest `
                -Uri $AppUrl `
                -UseBasicParsing `
                -TimeoutSec 1

            if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 500) {
                $ServerReady = $true
                break
            }
        }
        catch {
            # Vite is still starting.
        }
    }

    if (-not $ServerReady) {
        throw "The app did not start within 30 seconds."
    }

    # --------------------------------------------------------
    # Open Edge as a dedicated application window
    # --------------------------------------------------------

    $EdgeProcess = Start-Process `
    -FilePath $EdgePath `
    -ArgumentList @(
        "--app=$AppUrl",
        "--user-data-dir=$ProfileFolder",
        "--window-size=1400,950",
        "--window-position=100,100",
        "--no-first-run",
        "--disable-features=msEdgeSidebarV2"
    ) `
        -PassThru
    # Wait until this dedicated Edge app process closes.
    $EdgeProcess.WaitForExit()
}
catch {
    Add-Type -AssemblyName PresentationFramework

    $LogMessage = ""

    if (Test-Path $LogFile) {
        $LogMessage = Get-Content $LogFile -Tail 20 | Out-String
    }

    [System.Windows.MessageBox]::Show(
        "$($_.Exception.Message)`n`n$LogMessage",
        "Goodnotes PDF Prep",
        "OK",
        "Error"
    ) | Out-Null
}
finally {
    # --------------------------------------------------------
    # Stop Vite and every child process created by npm
    # --------------------------------------------------------

    if ($ServerProcess -and -not $ServerProcess.HasExited) {
        Start-Process `
            -FilePath "taskkill.exe" `
            -ArgumentList @(
                "/PID",
                $ServerProcess.Id,
                "/T",
                "/F"
            ) `
            -WindowStyle Hidden `
            -Wait
    }
}