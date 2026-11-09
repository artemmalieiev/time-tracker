import { byId, el } from './lib/dom';
import type { Entry } from './lib/storage';
import {
  entryDuration,
  finishTask,
  getPaused,
  getProjects,
  getRunning,
  pauseTask,
  resumeTask,
  setPublicDuration,
  startTask
} from './lib/storage';
import { formatDuration, formatDurationWords, formatTimer, parsePublicDuration, splitDuration } from './lib/time';
import { getEmail } from './lib/user';

const userLabel = byId('user', HTMLSpanElement);
const runningSection = byId('running', HTMLElement);
const runningTitle = byId('run-title', HTMLDivElement);
const runningProject = byId('run-project', HTMLDivElement);
const runningTimer = byId('run-timer', HTMLDivElement);
const runningSweep = byId('run-sweep', SVGCircleElement);
const pauseButton = byId('btn-pause', HTMLButtonElement);
const finishButton = byId('btn-finish', HTMLButtonElement);
const finishPanel = byId('finish-panel', HTMLElement);
const finishTitle = byId('finish-title', HTMLDivElement);
const finishTracked = byId('finish-tracked', HTMLDivElement);
const finishForm = byId('finish-form', HTMLFormElement);
const finishHoursInput = byId('finish-hours', HTMLInputElement);
const finishMinutesInput = byId('finish-minutes', HTMLInputElement);
const finishError = byId('finish-error', HTMLParagraphElement);
const finishSkipButton = byId('finish-skip', HTMLButtonElement);
const pausedSection = byId('paused-section', HTMLElement);
const pausedList = byId('paused-list', HTMLUListElement);
const showFormButton = byId('show-form', HTMLButtonElement);
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

// The task just finished, while the panel asking for its public time is open.
let finishing: Entry | null = null;

// Chrome caps a popup at 600px tall, so while a task runs the new task form stays folded behind a
// button until the person asks for it.
let formOpen = false;

function renderTimer() {
  if (running) {
    const duration = entryDuration(running, null, Date.now());
    runningTimer.textContent = formatTimer(duration);
    // The red arc moves like a quartz second hand: one tick per second, a full turn a minute.
    const seconds = Math.floor(duration / 1000) % 60;
    runningSweep.style.strokeDasharray = `${seconds} 60`;
  }
}

function renderPausedItem(entry: Entry) {
  const duration = formatDuration(entryDuration(entry, null, Date.now()));
  return el('li', {}, [
    el('div', { className: 'line' }, [
      el('span', { className: 'name', text: entry.title, title: entry.title }, []),
      el('span', { className: 'duration', text: duration }, [])
    ]),
    el('div', { className: 'line' }, [
      el('span', { className: 'project muted', text: entry.project || 'Без проекта' }, []),
      el('button', { className: 'small', dataset: { action: 'resume', id: entry.id }, text: 'Продолжить' }, []),
      el('button', { className: 'small quiet', dataset: { action: 'finish', id: entry.id }, text: 'Завершить' }, [])
    ])
  ]);
}

async function render() {
  running = await getRunning();
  const paused = await getPaused();
  const projects = await getProjects();

  clearInterval(tick);
  projectOptions.replaceChildren(...projects.map(name => el('option', { value: name }, [])));

  // While the finish panel is open it is the only thing on screen, whatever else changes.
  finishPanel.hidden = !finishing;
  if (finishing) {
    runningSection.hidden = true;
    pausedSection.hidden = true;
    showFormButton.hidden = true;
    form.hidden = true;
    return;
  }

  runningSection.hidden = !running;
  if (running) {
    runningTitle.textContent = running.title;
    runningProject.textContent = running.project || 'Без проекта';
    renderTimer();
    tick = setInterval(renderTimer, 1000);
  }

  const folded = !!running && !formOpen;
  form.hidden = folded;
  showFormButton.hidden = !folded;

  pausedSection.hidden = paused.length === 0;
  pausedList.replaceChildren(...paused.map(renderPausedItem));
}

/**
 * Finishes the task right away, so its time stops at the click, then asks for its public time.
 */
async function finishAndAsk(id: string) {
  const entry = await finishTask(id);
  const tracked = entryDuration(entry, null, Date.now());
  const parts = splitDuration(tracked);
  finishing = entry;
  finishTitle.textContent = entry.title;
  finishTracked.textContent = `Фактически: ${formatDurationWords(tracked)}`;
  finishHoursInput.value = '';
  finishMinutesInput.value = '';
  finishHoursInput.placeholder = parts.hours.toString();
  finishMinutesInput.placeholder = parts.minutes.toString();
  finishError.textContent = '';
  await render();
  finishHoursInput.focus();
}

function closeFinishPanel() {
  finishing = null;
  render().catch(console.warn);
}

async function savePublicDuration() {
  if (!finishing) {
    return;
  }
  const parsed = parsePublicDuration(finishHoursInput.value, finishMinutesInput.value);
  if (parsed.error !== null) {
    finishError.textContent = parsed.error;
    return;
  }
  if (parsed.milliseconds !== null) {
    await setPublicDuration(finishing.id, parsed.milliseconds);
  }
  closeFinishPanel();
}

function showFinishError(error: unknown) {
  finishError.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
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
      finishAndAsk(id).catch(console.warn);
      break;
    default:
      console.warn('Unknown paused task action', action);
  }
}

async function submitNewTask() {
  await startTask(titleInput.value, descriptionInput.value, projectInput.value);
  form.reset();
  formOpen = false;
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
    finishAndAsk(running.id).catch(console.warn);
  }
});

finishForm.addEventListener('submit', function onFinishSubmit(event) {
  event.preventDefault();
  finishError.textContent = '';
  savePublicDuration().catch(showFinishError);
});

finishSkipButton.addEventListener('click', function onFinishSkipClick() {
  closeFinishPanel();
});

pausedList.addEventListener('click', function onPausedClick(event) {
  const target = event.target;
  if (target instanceof HTMLButtonElement && target.dataset.id) {
    runPausedAction(target.dataset.action, target.dataset.id);
  }
});

showFormButton.addEventListener('click', function onShowFormClick() {
  formOpen = true;
  form.hidden = false;
  showFormButton.hidden = true;
  titleInput.focus();
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
