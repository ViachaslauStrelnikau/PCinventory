# PCinventory

Каркас системы инвентаризации компьютеров. Требования и этапы описаны в [DESIGN.md](DESIGN.md) и [плане реализации](docs/IMPLEMENTATION_PLAN.md). Состояние проверок Windows указано в [матрице совместимости](docs/COMPATIBILITY.md).

## Windows-агент

Для сборки нужны JDK 8 или новее и Maven 3.9.11. Из корня репозитория:

```powershell
mvn -B -f agent/pom.xml verify
java -jar agent/target/inventory-agent-0.1.0-SNAPSHOT.jar
```

В окне можно прочитать сведения о среде Java и заполнить учётную форму. Регистрация станет доступна после подключения коллектора и Firebase. Параметр `--probe` выводит сведения о среде в консоль и завершает процесс.

Чтобы посмотреть компоновку по референсу из `design/desktop app/`, запустите JAR с параметром `--preview`. Этот режим показывает синтетические характеристики, карточки ОЗУ и отдельные строки накопителей.

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
