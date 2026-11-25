# PCinventory

Система инвентаризации компьютеров с настольным агентом Windows и веб-реестром. Требования и этапы описаны в [DESIGN.md](DESIGN.md) и [плане реализации](docs/IMPLEMENTATION_PLAN.md). Состояние проверок Windows указано в [матрице совместимости](docs/COMPATIBILITY.md).

## Windows-агент

Для сборки нужны JDK 8 или новее и Maven 3.9.11. Из корня репозитория:

```powershell
mvn -B -f agent/pom.xml verify
java -jar agent/target/inventory-agent-0.1.0-SNAPSHOT.jar
```

По кнопке «Прочитать конфигурацию» испытательная сборка запрашивает локальные сведения через OSHI и WMI. Регистрация доступна при явном включении режима локального эмулятора. Параметр `--probe` выводит сведения о JVM, а `--hardware-probe` — результаты проверки источников и сводные счётчики без имён компьютеров и адресов IP.

Чтобы посмотреть компоновку по референсу из `design/desktop app/`, запустите JAR с параметром `--preview`. Этот режим показывает синтетические характеристики, карточки ОЗУ и отдельные строки накопителей.

### Испытательный EXE для Windows 7 SP1

Скачайте `InventoryAgent.exe` из последней сборки в [GitHub Releases](https://github.com/ViachaslauStrelnikau/PCinventory/releases). Скопируйте EXE на проверяемый компьютер, запустите под обычной учётной записью и нажмите «Прочитать конфигурацию». Проверьте версию и архитектуру ОС, ОЗУ, видеокарту, физические диски и режим сети. В нижней части блока конфигурации указаны недоступные источники, если запросы завершились с ошибками. EXE включает Java 8 x86 и запускается без установки.

Для повторной сборки на Windows нужны Maven 3.9.11, JDK, 7-Zip и доступ к закреплённым релизам. Запустите из корня репозитория:

```powershell
.\agent\packaging\build-windows-poc.ps1 -SevenZip 'C:\Program Files\7-Zip\7z.exe'
```

Скрипт проверяет SHA-256 входных архивов и сохраняет EXE и файл контрольной суммы в `agent/target/windows`.

GitHub Actions запускает сборку при изменениях в `agent/`, `contracts/` или в файле workflow, отправленных в `main`. Её также можно запустить вручную в **Actions → Build Windows EXE → Run workflow**. После успешной сборки из `main` EXE и файл SHA-256 публикуются в отдельном предварительном релизе. Эти же файлы доступны в **Artifacts → InventoryAgent-windows-x86** на странице запуска.

## Веб-приложение

Используйте Node.js 24.15 или новее в ветке 24 и npm из комплекта Node.js. Из корня репозитория:

```powershell
npm --prefix web ci
npm --prefix web start
```

Локальный адрес — `http://localhost:4200`. Для статической сборки выполните `npm --prefix web run build`. Результат находится в `web/dist/pcinventory/browser`.

## Локальный Firebase

Сначала соберите веб-приложение. Для Emulator Suite установите JDK 21 или новее и укажите его в `JAVA_HOME` и `PATH`. Запустите из корня:

```powershell
npm --prefix functions ci
npx --yes firebase-tools@15.37.0 emulators:start --only auth,firestore,functions,hosting --project demo-pcinventory
```

Hosting доступен по адресу `http://127.0.0.1:5000`, панель эмуляторов — `http://127.0.0.1:4000`. Проект с префиксом `demo-` используется локально.

Для первого администратора создайте временную учётную запись с почтой и паролем в Auth Emulator. Добавьте в Firestore Emulator документ `users/{uid}`, где `uid` скопирован из Auth, с полями `role: "ADMIN"` и `enabled: true`. Остальные веб-учётные записи создаются в разделе «Пользователи». При создании администратор задаёт начальный пароль. Там же можно изменить имя, почту и роль, деактивировать учётную запись или восстановить её доступ. При перезагрузке страницы потребуется снова войти.

Для автоматической проверки ролей и принятия отчётов выполните из корня репозитория.

```powershell
npm --prefix tests/rules ci
npm --prefix tests/rules test
```

Тесты запускают Auth и Firestore Emulator и создают синтетические записи. Для проверки Java-клиента с эмулятором выполните `npm --prefix tests/rules run test:agent` с Maven и JDK на `PATH`. [Правила доступа и проверка](docs/SECURITY.md)

Для проверки управления пользователями запустите тест в чистом экземпляре эмуляторов. Остановите текущий экземпляр или выделите для теста отдельные порты.

```powershell
npx --yes firebase-tools@15.37.0 emulators:exec --project demo-pcinventory --only auth,firestore,functions "npm --prefix functions test"
```

### Регистрация из окна агента

В локальном проекте `demo-pcinventory` создайте временного пользователя в Auth Emulator. В Firestore Emulator добавьте `users/{uid}` с полями `role: "COLLECTOR"` и `enabled: true`, а также `settings/inventory` с логическим полем `acceptingReports: true`. Для проверки используйте разрешённый тестовый ПК или виртуальную машину.

Включите режим перед запуском EXE из PowerShell.

```powershell
$env:PCINVENTORY_EMULATOR = '1'
.\InventoryAgent.exe
```

Нажмите «Прочитать конфигурацию», заполните здание, этаж, кабинет и поля временной учётной записи, затем нажмите «Зарегистрировать». Сообщение об успехе подтверждает запись `PENDING` в `inventoryReports`. Посмотреть документ можно в Emulator UI. После сетевого сбоя при неизменных данных повтор использует прежний ID. Пароль вводится заново после каждой попытки. Регистрация в этом режиме обращается только к локальным портам 9099 и 8080.
