# PCinventory

Каркас системы инвентаризации компьютеров. Требования и этапы описаны в [DESIGN.md](DESIGN.md) и [плане реализации](docs/IMPLEMENTATION_PLAN.md). Состояние проверок Windows указано в [матрице совместимости](docs/COMPATIBILITY.md).

## Windows-агент

Для сборки нужны JDK 8 или новее и Maven 3.9.11. Из корня репозитория:

```powershell
mvn -B -f agent/pom.xml verify
java -jar agent/target/inventory-agent-0.1.0-SNAPSHOT.jar
```

По кнопке «Прочитать конфигурацию» испытательная сборка запрашивает локальные сведения через OSHI и WMI. Регистрация станет доступна после подключения Firebase. Параметр `--probe` выводит сведения о JVM, а `--hardware-probe` — результаты проверки источников и сводные счётчики без имён компьютеров и адресов IP.

Чтобы посмотреть компоновку по референсу из `design/desktop app/`, запустите JAR с параметром `--preview`. Этот режим показывает синтетические характеристики, карточки ОЗУ и отдельные строки накопителей.

### Испытательный EXE для Windows 7 SP1

Скопируйте `agent/target/windows/InventoryAgent.exe` на проверяемый компьютер, запустите под обычной учётной записью и нажмите «Прочитать конфигурацию». Проверьте версию и архитектуру ОС, ОЗУ, видеокарту, физические диски и режим сети. В нижней части блока конфигурации указаны недоступные источники, если запросы завершились с ошибками. EXE включает Java 8 x86 и запускается без установки.

Для повторной сборки на Windows нужны Maven 3.9.11, JDK, 7-Zip и доступ к закреплённым релизам. Запустите из корня репозитория:

```powershell
.\agent\packaging\build-windows-poc.ps1 -SevenZip 'C:\Program Files\7-Zip\7z.exe'
```

Скрипт проверяет SHA-256 входных архивов и сохраняет EXE и файл контрольной суммы в `agent/target/windows`.

GitHub Actions запускает сборку при изменениях в `agent/` или в файле workflow, отправленных в `main`. Её также можно запустить вручную в **Actions → Build Windows EXE → Run workflow**. В успешном запуске откройте **Artifacts → InventoryAgent-windows-x86**. Архив содержит автономный EXE и файл SHA-256.

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
npx --yes firebase-tools@15.37.0 emulators:start --only auth,firestore,hosting --project demo-pcinventory
```

Hosting доступен по адресу `http://127.0.0.1:5000`, панель эмуляторов — `http://127.0.0.1:4000`. Проект с префиксом `demo-` используется локально. Правила Firestore закрывают чтение и запись, пока не утверждены контракт и модель доступа. Приложения запускаются без credentials и пока не обращаются к Firebase.
