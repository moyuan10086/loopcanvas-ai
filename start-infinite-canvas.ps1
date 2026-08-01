param(
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$web = Join-Path $root "web"
$agent = Join-Path $root "canvas-agent"

function Invoke-Npm {
    param(
        [Parameter(Mandatory)] [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string[]]$Arguments
    )

    Push-Location $WorkingDirectory
    try {
        & npm.cmd @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-Port {
    param([Parameter(Mandatory)] [int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Endpoint {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [Parameter(Mandatory)] [scriptblock]$IsReady,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if (& $IsReady $response) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Uri"
}

try {
    $host.UI.RawUI.WindowTitle = "Infinite Canvas Launcher"
    Write-Host ""
    Write-Host "[Infinite Canvas] Starting local services..."

    if (-not (Test-Path (Join-Path $web "package.json"))) {
        throw "Web project not found: $web"
    }
    if (-not (Test-Path (Join-Path $agent "package.json"))) {
        throw "Canvas Agent not found: $agent"
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw "Node.js is not installed or is not available in PATH."
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw "npm is not installed or is not available in PATH."
    }

    if (-not (Test-Path (Join-Path $web "node_modules\vite\bin\vite.js"))) {
        Write-Host "[1/5] Installing web dependencies..."
        Invoke-Npm -WorkingDirectory $web -Arguments @("install", "--legacy-peer-deps")
    }
    else {
        Write-Host "[1/5] Web dependencies are ready."
    }

    if (-not (Test-Path (Join-Path $agent "node_modules\typescript\bin\tsc"))) {
        Write-Host "[2/5] Installing Agent dependencies..."
        Invoke-Npm -WorkingDirectory $agent -Arguments @("install", "--no-package-lock")
    }
    else {
        Write-Host "[2/5] Agent dependencies are ready."
    }

    Write-Host "[3/5] Building Canvas Agent..."
    Invoke-Npm -WorkingDirectory $agent -Arguments @("run", "build")

    $webWasRunning = Test-Port -Port 3000
    if (-not $webWasRunning) {
        Write-Host "[4/5] Starting web app on http://localhost:3000 ..."
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", "npm run dev") -WorkingDirectory $web -WindowStyle Hidden
    }
    else {
        Write-Host "[4/5] Web app is already listening on port 3000."
    }

    $agentProcessIds = @(Get-NetTCPConnection -LocalPort 17371 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($agentProcessIds.Count -gt 0) {
        Write-Host "[5/5] Restarting local Agent to load the latest build..."
        $agentProcessIds | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction Stop }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Test-Port -Port 17371) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 100
        }
        if (Test-Port -Port 17371) {
            throw "Could not stop the previous Canvas Agent on port 17371."
        }
    }
    else {
        Write-Host "[5/5] Starting local Agent on http://127.0.0.1:17371 ..."
    }
    Start-Process -FilePath "node.exe" -ArgumentList @("dist/index.js") -WorkingDirectory $agent -WindowStyle Hidden

    Wait-Endpoint -Uri "http://127.0.0.1:17371/health" -IsReady {
        param($response)
        $data = $response.Content | ConvertFrom-Json
        return $data.ok -eq $true
    }
    Write-Host "[CHECK] Canvas Agent is healthy."
    Wait-Endpoint -Uri "http://127.0.0.1:3000" -IsReady {
        param($response)
        return $response.StatusCode -eq 200
    }
    Write-Host "[CHECK] Web app is ready."

    $codex = Get-Command codex -ErrorAction SilentlyContinue
    if ($codex) {
        Write-Host "[MCP] Checking Codex registration..."
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & codex mcp get infinite-canvas *> $null
            $mcpRegistered = $LASTEXITCODE -eq 0
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if (-not $mcpRegistered) {
            Write-Host "[MCP] Registering Infinite Canvas with Codex..."
            try {
                $ErrorActionPreference = "Continue"
                & codex mcp add infinite-canvas -- node (Join-Path $agent "dist\index.js") mcp
                $mcpAddExitCode = $LASTEXITCODE
            }
            finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
            if ($mcpAddExitCode -ne 0) {
                throw "Could not register the Infinite Canvas MCP server."
            }
        }
        else {
            Write-Host "[MCP] Infinite Canvas is already registered with Codex."
        }
    }

    $configPath = Join-Path $env:USERPROFILE ".infinite-canvas\canvas-agent.json"
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Local Agent connection configuration was not created."
    }
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $canvasUrl = "http://localhost:3000/canvas?mode=recent&agentUrl=$([uri]::EscapeDataString($config.url))&agentToken=$([uri]::EscapeDataString($config.token))"
    if (-not $webWasRunning) {
        Write-Host "[OPEN] Opening a connected canvas..."
        Start-Process $canvasUrl
    }
    else {
        Write-Host "[OPEN] Existing browser session kept; no new canvas was opened."
    }

    Write-Host ""
    Write-Host "[READY] Infinite Canvas: http://localhost:3000" -ForegroundColor Green
    Write-Host "[READY] Canvas Agent:   http://127.0.0.1:17371" -ForegroundColor Green
    if (-not $webWasRunning) {
        Write-Host "[READY] A connected canvas has been opened in your browser." -ForegroundColor Green
    }
    Write-Host ""

    if (-not $NoPause) {
        Read-Host "Press Enter to close this launcher. Services will keep running"
    }
}
catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    if (-not $NoPause) {
        Read-Host "Press Enter to close"
    }
    exit 1
}
