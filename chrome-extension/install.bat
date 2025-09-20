@echo off
echo ============================================================
echo              PromptMaster 智能提示词管理器
echo                    一键安装脚本
echo ============================================================
echo.

:: 检查Chrome是否安装
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
    echo 找到Chrome浏览器: C:\Program Files\Google\Chrome\Application\chrome.exe
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    echo 找到Chrome浏览器: C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    echo 找到Chrome浏览器: %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
) else if exist "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"
    echo 找到Chrome浏览器: %PROGRAMFILES%\Google\Chrome\Application\chrome.exe
) else (
    echo ❌ 未找到Chrome浏览器，请手动安装Chrome
    echo 下载地址: https://www.google.com/chrome/
    goto :manual
)

:: 检查当前目录是否包含必要的文件
if not exist "manifest.json" (
    echo ❌ 当前目录未找到manifest.json文件
    echo 请确保在chrome-extension目录中运行此脚本
    pause
    exit /b 1
)

:: 打开Chrome扩展页面
echo.
echo ✅ 正在打开Chrome扩展页面...
echo.
timeout /t 2 /nobreak > nul
%CHROME_PATH% chrome://extensions/

echo.
echo ============================================================
echo                    安装步骤说明
echo ============================================================
echo.
echo 1. 在Chrome扩展页面开启右上角的"开发者模式"开关
echo.
echo 2. 点击"加载已解压的扩展程序"按钮
echo.
echo 3. 在弹出的文件夹选择器中选择当前目录
echo.
echo 4. 扩展安装完成后，点击扩展图标进行配置
echo.
echo 5. 在设置页面配置飞书API参数：
echo    - App ID
echo    - App Secret
echo    - 多维表格 App Token
echo    - 数据表 ID
echo.
echo 6. 点击"测试连接"验证配置是否正确
echo.
echo ============================================================
echo                   安装完成！
echo ============================================================
echo.
echo 📖 详细使用说明请查看 README.md 文件
echo.
echo 🎉 现在开始使用您的智能提示词管理器吧！
echo.
pause
exit /b 0

:manual
echo.
echo ============================================================
echo                    手动安装步骤
echo ============================================================
echo.
echo 1. 打开Chrome浏览器
echo 2. 在地址栏输入: chrome://extensions/
echo 3. 开启右上角的"开发者模式"
echo 4. 点击"加载已解压的扩展程序"
echo 5. 选择当前目录
echo.
pause