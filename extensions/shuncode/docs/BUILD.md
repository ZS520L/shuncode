# 🛠️ Shuncode AI Extension: "Золотой план сборки" (Windows)

Эта инструкция гарантированно собирает расширение, обходя известные проблемы с `protobuf`, `grpc-tools` и кэшем на Windows.

Все команды выполняются в **PowerShell** из папки:
`D:\Users\Admin\Desktop\Shuncode\vscode\extensions\shuncode`

---

## 🧹 ЭТАП 1: Полная зачистка (Если всё сломалось)
Выполнять, если возникают ошибки типов, `Cannot find module`, или после неудачных слияний.

```powershell
# Удаляем всё лишнее
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
Remove-Item -Recurse -Force dist
Remove-Item -Recurse -Force src/generated
Remove-Item -Recurse -Force src/shared/proto
```

---

## 📦 ЭТАП 2: Установка зависимостей
```powershell
npm install
```

---

## 🔧 ЭТАП 3: Ручной патч Protoc (КРИТИЧЕСКИ ВАЖНО)
`npm` на Windows часто не скачивает `protoc.exe` корректно. Этот шаг скачивает его вручную и кладет в нужное место.

**Скопируйте и выполните весь блок целиком:**

```powershell
# 1. Создаем временную папку
mkdir temp_protoc_setup -ErrorAction SilentlyContinue

# 2. Скачиваем рабочий protoc (v3.20.3)
Invoke-WebRequest -Uri "https://github.com/protocolbuffers/protobuf/releases/download/v3.20.3/protoc-3.20.3-win64.zip" -OutFile "temp_protoc_setup\protoc.zip"

# 3. Распаковываем
Expand-Archive -Path "temp_protoc_setup\protoc.zip" -DestinationPath "temp_protoc_setup\extracted" -Force

# 4. Копируем EXE в grpc-tools (туда, где его ждет скрипт сборки)
Copy-Item -Path "temp_protoc_setup\extracted\bin\protoc.exe" -Destination "node_modules\grpc-tools\bin\protoc.exe" -Force

# 5. Копируем папку include (обязательно для стандартных типов Google)
Copy-Item -Path "temp_protoc_setup\extracted\include" -Destination "node_modules\grpc-tools\bin" -Recurse -Force

# 6. Убираем мусор
Remove-Item "temp_protoc_setup" -Recurse -Force

Write-Host "✅ Protoc установлен успешно!" -ForegroundColor Green
```

---

## ⚙️ ЭТАП 4: Генерация кода и Сборка

```powershell
# 1. Генерация TypeScript из .proto файлов
# ОБЯЗАТЕЛЬНО при изменении proto/shuncode/*.proto (state.proto, models.proto и др.)
npm run protos

# 2. Сборка webview (при изменении webview-ui/)
cd webview-ui
npm run build
cd ..

# 3. Сборка extension (esbuild)
# Используем напрямую, так как npm run compile прогоняет еще линтеры, что долго
node esbuild.mjs
```

---

## 🚀 ЭТАП 5: Запуск
Для запуска форка VS Code с расширением выполните команду **из корня репозитория** (`D:\Users\Admin\Desktop\Shuncode\vscode`):

```powershell
.\scripts\code.bat --extensionDevelopmentPath="D:\Users\Admin\Desktop\Shuncode\vscode\extensions\shuncode"
```
