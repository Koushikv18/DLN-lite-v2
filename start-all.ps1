Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "   🚀 Starting DLN-Lite Full Stack 🚀   " -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start Blockchain (in WSL)
Write-Host "[1/4] 📦 Starting Hyperledger Fabric Network (via WSL)..." -ForegroundColor Yellow
Write-Host "      This will take a minute or two. Please wait..." -ForegroundColor Gray
wsl -e bash -c "cd /mnt/c/Users/koush/OneDrive/Desktop/DLN-LITE-V1/blockchain/network && ./stop-network.sh && ./start-network.sh"
Write-Host "✅ Blockchain Network is UP!" -ForegroundColor Green
Write-Host ""

# 2. Start ML Service (FastAPI) in a new window
Write-Host "[2/4] 🧠 Starting ML Service (Port 5000) in a new window..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -Path '$PSScriptRoot\ml'; python app.py"
Write-Host "✅ ML Service launched!" -ForegroundColor Green
Write-Host ""

# 3. Start Backend in a new window
Write-Host "[3/4] ⚙️  Starting Node.js Backend (Port 4000) in a new window..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -Path '$PSScriptRoot\backend'; npm run dev"
Write-Host "✅ Backend launched!" -ForegroundColor Green
Write-Host ""

# 4. Start Frontend in a new window
Write-Host "[4/4] 🌐 Starting React Frontend (Port 3000) in a new window..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -Path '$PSScriptRoot\frontend'; npm start"
Write-Host "✅ Frontend launched!" -ForegroundColor Green
Write-Host ""

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "🎉 All services have been started!" -ForegroundColor Green
Write-Host "Check the newly opened terminal windows for real-time logs." -ForegroundColor Gray
Write-Host "===========================================" -ForegroundColor Cyan
