const storageKey = 'coffeeman.vacancies.demo.v2';
const fileTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const limitBytes = 2 * 1024 * 1024;

const form = document.querySelector('#form');
const age = document.querySelector('#age');
const study = document.querySelector('#study');
const school = document.querySelector('#school');
const parents = document.querySelector('#parents');
const consent = document.querySelector('#consent');
const uploadBox = document.querySelector('#upload-box');
const paperBox = document.querySelector('#paper-box');
const status = document.querySelector('#status');
const submit = form.querySelector('[type=submit]');

function sync() {
  const isMinor = age.validity.valid && age.valueAsNumber < 18;
  const isStudying = study.value === 'Да';
  const delivery = form.elements.consentDelivery.value;
  const attaching = isMinor && delivery === 'upload';

  parents.hidden = !isMinor;
  document.querySelector('#schoolBox').hidden = !isStudying;
  school.required = isStudying;
  uploadBox.hidden = !attaching;
  paperBox.hidden = !isMinor || delivery !== 'in-person';
  consent.disabled = !attaching;
  consent.required = attaching;
}

age.addEventListener('input', sync);
study.addEventListener('change', sync);
for (const option of form.elements.consentDelivery) {
  option.addEventListener('change', sync);
}
window.addEventListener('pageshow', sync);
sync();

function readConsent(file) {
  if (!file || !file.size || file.size > limitBytes || !fileTypes.has(file.type)) {
    throw new Error('Выбери непустой файл PDF, JPEG или PNG до 2 МБ.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve({name: file.name, type: file.type, data: reader.result}));
    reader.addEventListener('error', () => reject(new Error('Не удалось прочитать файл согласия. Выбери его ещё раз.')));
    reader.readAsDataURL(file);
  });
}

async function buildApplication() {
  const data = Object.fromEntries(new FormData(form));
  if (study.value !== 'Да') delete data.school;
  if (parents.hidden) delete data.parent;
  if (parents.hidden || data.consentDelivery === 'discuss') delete data.consentDelivery;
  if (data.consentDelivery === 'upload') data.attachment = await readConsent(consent.files[0]);
  return {...data, status: 'Новая', createdAt: new Date().toISOString()};
}

function saveDemo(data) {
  data.id = crypto.randomUUID();
  let savedLocally = false;
  try {
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    items.push(data);
    localStorage.setItem(storageKey, JSON.stringify(items));
    savedLocally = true;
  } catch {
    // The export also works when browser storage is unavailable or full.
  }

  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'coffeeman-demo-' + data.id + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return savedLocally
    ? 'Тестовая анкета добавлена в HR Studio в этом браузере. JSON можно импортировать в другом браузере.'
    : 'Локальное сохранение недоступно. Импортируй скачанный JSON в HR Studio.';
}

function handleSubmit(save) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = '';
    try {
      status.textContent = await save(await buildApplication());
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось подготовить анкету.';
    } finally {
      submit.disabled = false;
    }
  });
  submit.disabled = false;
}

async function setupLive() {
  const [
    {initializeApp},
    {getDatabase, ref, set, serverTimestamp},
    {getAuth, signInAnonymously, setPersistence, inMemoryPersistence},
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
  ]);
  const app = initializeApp({
    apiKey: 'AIzaSyAW1wceiij_blsEQNF8OabIL_RuLub_9HE',
    authDomain: 'gbank-838eb.firebaseapp.com',
    databaseURL: 'https://gbank-838eb-default-rtdb.firebaseio.com/',
    projectId: 'gbank-838eb',
    appId: '1:393268159217:web:db64b7b8a0b1387f3b7f50',
  }, 'COFFEEMAN_VACANCIES');
  const database = getDatabase(app);
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);

  document.querySelector('#demo-notice').hidden = true;
  document.querySelector('#file-hint').textContent = 'Убедись, что файл полностью читается.';
  document.querySelector('#confirmation-text').textContent =
    'Согласен(на) на обработку данных для рассмотрения анкеты после ознакомления с политикой обработки данных работодателя.';
  submit.textContent = 'Отправить анкету';
  handleSubmit(async data => {
    const {user} = await signInAnonymously(auth);
    await set(ref(database, 'vacancies/applications/' + user.uid), {
      ...data, id: user.uid, createdAtServer: serverTimestamp(),
    });
    form.reset();
    sync();
    return 'Анкета отправлена. Администратор свяжется с тобой по указанному контакту.';
  });
}

// Enable only after configuring the HR accounts and deploying restrictive database rules.
const live = false;
if (live) {
  setupLive().catch(() => {
    status.textContent = 'Приём анкет сейчас недоступен. Попробуй позже.';
  });
} else {
  handleSubmit(saveDemo);
}
