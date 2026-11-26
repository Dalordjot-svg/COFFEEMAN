# Firebase Realtime Database

COFFEEMAN использует два режима. В `demo` каталог и учебные заказы хранятся в IndexedDB текущего браузера и синхронизируются между его вкладками. В `firebase` данные хранятся в Realtime Database, сотрудники входят через Firebase Authentication, а изменения проходят через функцию `coffeemanCommand`. Демонстрационный вход по имени и слово `admin` доступны только в локальном режиме.

## Рабочее подключение

1. Откройте существующий проект Firebase `gbank-838eb`. В **Build → Realtime Database** выберите нужный экземпляр и скопируйте адрес из вкладки **Data**. Точный `databaseURL` отсутствовал в исходных настройках. Адрес зависит от экземпляра и региона.
2. В **Project settings → Your apps** скопируйте конфигурацию веб-клиента. Создайте `.env.local` из `.env.example`, поставьте `VITE_APP_MODE=firebase` и заполните ключ веб-клиента, домен Auth, адрес Realtime Database, ID проекта и ID приложения. Поле эмулятора оставьте пустым. Переменные `VITE_` доступны браузеру. Ключи сервисных аккаунтов и другие секреты должны оставаться в доверенной серверной среде.
3. В **Authentication → Sign-in method** включите Email/Password и разрешите домен приложения в **Authentication → Settings → Authorized domains**. Это общие для проекта настройки. Согласуйте их с владельцами остальных приложений Firebase перед изменением.
4. Выгрузите и проверьте текущие правила Realtime Database. Из [шаблона](../database.rules.template.json) перенесите только ветку `rules.coffeeman` в правила нужного экземпляра, сохранив остальные узлы и права. Проверьте отсутствие разрешающих правил у предков этого пути. Такие правила Firebase наследуются и ниже по дереву отменить их нельзя. Проверьте правила на эмуляторе или в Rules Playground до публикации. `firebase.json` содержит только конфигурацию Functions и не разворачивает правила.
5. Используйте Node.js 22 для Functions. Установите зависимости команды `npm ci --prefix functions`. Создайте `functions/.env.gbank-838eb` с записью `COFFEEMAN_DATABASE_URL=<точный адрес базы>`. Разверните функцию из корня проекта командой `npx firebase-tools deploy --project gbank-838eb --only functions:coffeemanCommand`. Требуются права на Cloud Functions и поддерживаемый тариф Firebase. Среда выполнения функции должна иметь право читать и писать в выбранную RTDB. Регион функции по умолчанию `us-central1`.
6. Создайте рабочие аккаунты в Firebase Authentication. Доверенный администратор должен присвоить каждому аккаунту custom claim `coffeemanRole` со значением `waiter` или `admin`. С помощью Application Default Credentials можно использовать `npm --prefix functions run account -- gbank-838eb сотрудник@example.com waiter "Имя сотрудника"`. Для создания нового аккаунта укажите начальный пароль через `COFFEEMAN_ACCOUNT_PASSWORD` в защищённой среде или отправьте ссылку сброса пароля средствами Firebase Authentication. Команда сохраняет другие claims существующего аккаунта. После изменения claims сотруднику следует войти заново.
7. Запустите приложение. Первый вход регистрирует профиль по Firebase Auth UID. Администратор создаёт рабочий каталог, залы и столы в панели. Новая база по умолчанию пуста.

Активные сотрудники одного заведения могут просматривать общие заказы, каталог, остатки и имена коллег. Данные зарегистрированных устройств, журнал и движения по складу доступны администраторам. Браузерная запись запрещена для всех ролей. Cloud Functions проверяет токен, рабочий профиль и команду, затем выполняет транзакцию в `coffeeman/`. Для отключения действующего аккаунта деактивируйте его в панели COFFEEMAN, чтобы доступ из текущей сессии тоже был закрыт.

Транзакция включает позиции заказа, резервы, физические остатки, уведомления и запись журнала. Отправка конкурирующих заказов проверяет свободный остаток в одной транзакции. При повторной отправке того же идентификатора операции возвращается прежний результат. Серверные метки создаются кодом Cloud Functions и разрешаются Realtime Database. Рабочий режим требует сети для изменений.

## Firebase Emulator Suite

Эмулятор требует Java 21 и использует синтетический проект `demo-coffeeman`. Он не обращается к данным рабочего заведения.

```bash
npm ci --prefix functions
npm run build --prefix functions
COFFEEMAN_DATABASE_URL=https://demo-coffeeman-default-rtdb.firebaseio.com \
  npx firebase-tools emulators:exec --config firebase.emulator.json \
  --project demo-coffeeman --only auth,database,functions \
  "npm run test:emulator --prefix functions && npm run test:emulator:browser --prefix functions"
```

Браузерный тест использует Chromium и зависимости корневого проекта. Если Chromium не установлен в системе, установите браузер командой `npx playwright install chromium`. Если локальные адреса идут через HTTP-прокси, настройте исключения для `localhost` и `127.0.0.1`.

Для проверки в браузере запустите `emulators:start` с теми же аргументами Firebase и отдельно запустите Vite со следующей конфигурацией `.env.local`.

```dotenv
VITE_APP_MODE=firebase
VITE_FIREBASE_API_KEY=emulator-test-key
VITE_FIREBASE_AUTH_DOMAIN=demo-coffeeman.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-coffeeman-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=demo-coffeeman
VITE_FIREBASE_APP_ID=1:123:web:coffeeman
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
```

Аккаунт для ручной проверки можно создать в Auth Emulator с временным паролем.

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 COFFEEMAN_ACCOUNT_PASSWORD=test-only-password \
  npm --prefix functions run account -- demo-coffeeman admin@example.test admin "Администратор"
```
