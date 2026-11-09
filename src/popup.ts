import { byId, el } from './lib/dom';
import type { Entry } from './lib/storage';
import { entryDuration, finishTask, getPaused, getProjects, getRunning, pauseTask, resumeTask, startTask } from './lib/storage';
import { formatDuration, formatTimer } from './lib/time';
import { getEmail } from './lib/user';

const userLabel = byId('user', HTMLSpanElement);
const runningSection = byId('running', HTMLElement);
const runningTitle = byId('run-title', HTMLDivElement);
const runningProject = byId('run-project', HTMLDivElement);
const runningTimer = byId('run-timer', HTMLDivElement);
const pauseButton = byId('btn-pause', HTMLButtonElement);
const finishButton = byId('btn-finish', HTMLButtonElement);
const pausedSection = byId('paused-section', HTMLElement);
const pausedList = byId('paused-list', HTMLUListElement);
const form = byId('new-form', HTMLFormElement);
const titleInput = byId('f-title', HTMLInputElement);
const descriptionInput = byId('f-desc', HTMLTextAreaElement);
const projectInput = byId('f-project', HTMLInputElement);
const projectOptions = byId('projects', HTMLDataListElement);
const formError = byId('form-error', HTMLParagraphElement);
const openLogLink = byId('open-log', HTMLAnchorElement);
const addManualLink = byId('add-manual', HTMLAnchorElement);

let running: Entry | null = null;
let tick = 0;

function renderTimer() {
  if (running) {
    runningTimer.textContent = formatTimer(entryDuration(running, null, Date.now()));
  }
}

function renderPausedItem(entry: Entry) {
  const duration = formatDuration(entryDuration(entry, null, Date.now()));
  const meta = `${entry.project || 'Без проекта'} · ${duration}`;
  return el('li', {}, [
    el('div', { className: 'info' }, [
      el('div', { className: 'name', text: entry.title, title: entry.title }, []),
      el('div', { className: 'meta muted', text: meta }, [])
    ]),
    el('button', { className: 'small primary', dataset: { action: 'resume', id: entry.id }, text: 'Продолжить' }, []),
    el('button', { className: 'small', dataset: { action: 'finish', id: entry.id }, text: 'Завершить' }, [])
  ]);
}

async function render() {
  running = await getRunning();
  const paused = await getPaused();
  const projects = await getProjects();

  runningSection.hidden = !running;
  clearInterval(tick);
  if (running) {
    runningTitle.textContent = running.title;
    runningProject.textContent = running.project || 'Без проекта';
    renderTimer();
    tick = setInterval(renderTimer, 1000);
  }

  pausedSection.hidden = paused.length === 0;
  pausedList.replaceChildren(...paused.map(renderPausedItem));
  projectOptions.replaceChildren(...projects.map(name => el('option', { value: name }, [])));
}

async function renderUser() {
  const email = await getEmail();
  userLabel.textContent = email || 'не выполнен вход в Chrome';
  userLabel.title = email;
}

function runPausedAction(action: string | undefined, id: string) {
  switch (action) {
    case 'resume':
      resumeTask(id).catch(console.warn);
      break;
    case 'finish':
      finishTask(id).catch(console.warn);
      break;
    default:
      console.warn('Unknown paused task action', action);
  }
}

async function submitNewTask() {
  await startTask(titleInput.value, descriptionInput.value, projectInput.value);
  form.reset();
}

function showFormError(error: unknown) {
  formError.textContent = error instanceof Error ? error.message : 'Не удалось начать задачу';
}

async function openJournal(hash: string) {
  await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + hash });
  window.close();
}

pauseButton.addEventListener('click', function onPauseClick() {
  if (running) {
    pauseTask(running.id).catch(console.warn);
  }
});

finishButton.addEventListener('click', function onFinishClick() {
  if (running) {
    finishTask(running.id).catch(console.warn);
  }
});

pausedList.addEventListener('click', function onPausedClick(event) {
  const target = event.target;
  if (target instanceof HTMLButtonElement && target.dataset.id) {
    runPausedAction(target.dataset.action, target.dataset.id);
  }
});

form.addEventListener('submit', function onSubmit(event) {
  event.preventDefault();
  formError.textContent = '';
  submitNewTask().catch(showFormError);
});

openLogLink.addEventListener('click', function onOpenLogClick(event) {
  event.preventDefault();
  openJournal('').catch(console.warn);
});

addManualLink.addEventListener('click', function onAddManualClick(event) {
  event.preventDefault();
  openJournal('#new').catch(console.warn);
});

chrome.storage.onChanged.addListener(function onStorageChanged(changes, area) {
  if (area === 'local' && 'entries' in changes) {
    render().catch(console.warn);
  }
});

renderUser().catch(console.warn);
render().catch(console.warn);
