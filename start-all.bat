@echo off
echo ===========================================
echo    🚀 Starting DLN-Lite Full Stack 🚀   
echo ===========================================
echo.

echo [1/4] 📦 Starting Hyperledger Fabric Network (via WSL)...
echo       This will take a minute or two. Please wait...
wsl -e bash -c "cd /mnt/c/Users/koush/OneDrive/Desktop/DLN-LITE-V1/blockchain/network && ./stop-network.sh && ./start-network.sh"
echo ✅ Blockchain Network is UP!
echo.

echo [2/4] 🧠 Starting ML Service (Port 5000) in a new window...
start "DLN-Lite ML Service" cmd /c "cd /d %~dp0ml && python app.py"
echo ✅ ML Service launched!
echo.

echo [3/4] ⚙️  Starting Node.js Backend (Port 4000) in a new window...
start "DLN-Lite Backend" cmd /c "cd /d %~dp0backend && npm run dev"
echo ✅ Backend launched!
echo.

echo [4/4] 🌐 Starting React Frontend (Port 3000) in a new window...
start "DLN-Lite Frontend" cmd /c "cd /d %~dp0frontend && npm start"
echo ✅ Frontend launched!
echo.

echo ===========================================
echo 🎉 All services have been started!
echo Check the newly opened terminal windows for real-time logs.
echo ===========================================
pause
