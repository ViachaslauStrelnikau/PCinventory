# Развёртывание на Firebase Spark

Целевой проект пилота — `pc-inventory-9b119` (`PC-INVENTORY`). Веб-интерфейс работает на Firebase Hosting, вход через Email/Password в Firebase Authentication, данные и права в Cloud Firestore. Внешний сервер и инфраструктура предприятия этой схеме не требуются. Для пилота достаточно одной базы `(default)` редакции Standard в режиме Native. В пилотном проекте создана база `(default)` в Варшаве (`europe-central2`). Firebase подтвердил редакцию Standard, режим Native и бесплатную квоту (`freeTier: true`). [Тарифы Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Бесплатная квота Firestore](https://firebase.google.com/docs/firestore/quotas)

В пилотном проекте зарегистрировано веб-приложение **PCinventory Web** (`1:739277298650:web:af49cafc1085173aa43ee3`). Стандартный сайт — `pc-inventory-9b119.web.app`. Оба стандартных домена Hosting разрешены в Authentication. Вход по почте и паролю и обязательная политика паролей включены. Google настроил Authentication в режиме Identity Platform на Spark с лимитом 3 000 активных пользователей в сутки для Email/Password. Биллинг отключён. [Лимиты Firebase Authentication](https://firebase.google.com/docs/auth/limits)

Пилот опубликован на [pc-inventory-9b119.web.app](https://pc-inventory-9b119.web.app) через [Deploy Firebase](https://github.com/ViachaslauStrelnikau/PCinventory/actions/runs/45765106460). Проверены загрузка страницы входа, веб-конфигурация, совпадение опубликованных правил Firestore с репозиторием и запрет чтения без входа. Первый администратор создан. Firebase принял запрос на отправку письма для установки пароля.

## Первая настройка проекта

1. Проверьте тариф Spark. При подготовке нового проекта создайте базу `(default)` в регионе `europe-central2` (Варшава) в режиме Production. Подготовьте стандартный сайт Firebase Hosting с ID проекта и зарегистрируйте веб-приложение в настройках проекта.
2. Включите способ входа Email/Password. В Authentication включите обязательную политику паролей от 8 до 128 символов с одной строчной латинской буквой, одной прописной латинской буквой и одной цифрой. Отключите самостоятельное удаление учётных записей и оставьте самостоятельную регистрацию включённой. Проверьте, что используемый домен Hosting внесён в список разрешённых доменов. [Настройка входа и политики паролей](https://firebase.google.com/docs/auth/web/password-auth)
3. Создайте первую учётную запись администратора и подтвердите, что она принадлежит уполномоченному сотруднику. В Firestore создайте `users/{uid}` с его UID из Authentication, строковыми полями `role` = `ADMIN` и `email` с его адресом и логическим полем `enabled` = `true`. В `settings/access` задайте строковое поле `adminUid` с тем же UID.
4. Сотрудники запрашивают доступ со страницы входа, а администратор одобряет запросы. В разделе «Пользователи» также доступны изменение имени и роли, деактивация и восстановление доступа. Изменение адреса входа другого пользователя выполняется оператором Firebase Authentication. После подтверждения нового адреса пользователь войдёт с ним, и почта обновится в профиле. [Инструкция для сотрудников и администраторов](USER_ACCESS.md)

## Подготовка ручной GitHub Action

Workflow **Deploy Firebase** запускается вручную с ветки `main`, проверяет сборку и правила на эмуляторах, затем проверяет наличие стандартного сайта и базы и публикует Firebase Hosting, правила и индексы Firestore. Указанный в форме `project_id` должен совпасть с разрешённым проектом в GitHub Environment `firebase`. [Firebase CLI](https://firebase.google.com/docs/cli) · [Запуск workflow вручную](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

1. Создайте в Google Cloud сервисную учётную запись для развёртывания. В целевом проекте назначьте ей Firebase Hosting Admin (`roles/firebasehosting.admin`), Firebase Rules Admin (`roles/firebaserules.admin`), Cloud Datastore Index Admin (`roles/datastore.indexAdmin`), API Keys Viewer (`roles/serviceusage.apiKeysViewer`) и Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`). Учётная запись публикует код и правила, поэтому доступ к запуску и изменениям `main` должен быть ограничен. [Роли Firebase Hosting](https://firebase.google.com/docs/projects/iam/roles-predefined-product#hosting-roles) · [Роли Firebase Rules](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaserules) · [Роли Firestore](https://cloud.google.com/firestore/native/docs/security/iam) · [Роли Service Usage](https://cloud.google.com/iam/docs/roles-permissions/serviceusage)
2. Включите необходимые IAM, Resource Manager, IAM Service Account Credentials и Security Token Service API. Настройте Workload Identity Federation с провайдером GitHub OIDC (`https://token.actions.githubusercontent.com`). Сопоставьте `google.subject=assertion.sub` и `attribute.repository_id=assertion.repository_id`. Условие провайдера должно проверять числовые `assertion.repository_owner_id` и `assertion.repository_id`, ветку `assertion.ref == 'refs/heads/main'`, окружение `assertion.environment == 'firebase'`, ручной запуск `assertion.event_name == 'workflow_dispatch'` и путь `assertion.workflow_ref == 'ViachaslauStrelnikau/PCinventory/.github/workflows/deploy-web.yml@refs/heads/main'`. Выдайте этому репозиторию `roles/iam.workloadIdentityUser` **на сервисной учётной записи**, связывая её с `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository_id/REPOSITORY_ID`. Используйте номер проекта, в котором создан пул. [Настройка Workload Identity Federation для GitHub](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
3. В GitHub Environment `firebase` разрешите развёртывание с `main`. Задайте переменные окружения из таблицы.
4. В GitHub откройте Actions → Deploy Firebase → Run workflow. Выберите `main` и укажите `pc-inventory-9b119`. После успешного запуска проверьте вход администратора и пользователя по HTTPS, затем подтвердите, что сборщик может войти и прочитать справочник, а его пробный отчёт попадает в очередь.

| Переменная GitHub Environment | Значение |
|---|---|
| `FIREBASE_PROJECT_ID` | `pc-inventory-9b119` для выбранного пилота |
| `FIREBASE_WEB_APP_ID` | `appId` из настроек зарегистрированного веб-приложения |
| `FIREBASE_WEB_API_KEY` | `apiKey` из того же веб-приложения |
| `FIREBASE_RESTORE_OAUTH_CLIENT_ID` | Публичный Google OAuth Client ID для восстановления через браузер. [Подключение](FIRESTORE_BACKUP.md#настройка-входа-google-для-восстановления) |
| `FIREBASE_WIF_PROVIDER` | Полный путь `projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `FIREBASE_DEPLOY_SERVICE_ACCOUNT` | Адрес сервисной учётной записи развёртывания |

Веб-конфигурация включается в статическую сборку. Её `apiKey` идентифицирует проект, доступ к данным определяют правила Firestore. Workflow получает временные облачные полномочия по OIDC. [Ключи API Firebase](https://firebase.google.com/docs/projects/api-keys) · [Google Cloud Auth для GitHub Actions](https://github.com/google-github-actions/auth)

## Подключение Windows-агента

В пилотном проекте учётная запись сборщика и четыре GitHub Secrets настроены. Пользователь подтвердил отправку тестового отчёта из Windows 7 SP1 в облачную очередь. [Сборка Windows 9.1](https://github.com/ViachaslauStrelnikau/PCinventory/releases/tag/windows-build-9.1)

Создайте отдельную учётную запись сборщика в Authentication. В Firestore добавьте `users/{uid}` с `role` = `COLLECTOR` и `enabled` = `true`. Настройте четыре GitHub Secrets для сборки агента по [инструкции в README](../README.md). Приём по умолчанию закрыт. Откройте его в веб-настройках, когда будете готовы принять тестовый отчёт.

## Обновления и переезд

Для передачи существующего проекта другому Google-аккаунту используйте [инструкцию по смене владельца Firebase-проекта](FIREBASE_ACCOUNT_MIGRATION.md).

Изменения Angular, правил и индексов публикуются повторным ручным запуском. Для нового проекта повторите начальную настройку, перенастройте GitHub Environment и CI-сборку Windows-агента. Учётные записи Authentication и документы Firestore переносятся отдельно с проверкой UID и связей в `users`, `settings/access`, отчётах, карточках и справочнике. Для карточек, отчётов и справочников используйте локальное копирование и проверку восстановления в отдельном проекте. [Резервная копия Firestore](FIRESTORE_BACKUP.md) Управляемый Firestore export/import требует биллинга и недоступен на Spark. [Управляемый экспорт и импорт Firestore](https://firebase.google.com/docs/firestore/manage-data/export-import)
