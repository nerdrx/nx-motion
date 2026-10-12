(() => {
  const $ = (selector) => document.querySelector(selector);
  const api = window.motion;
  const state = { files: [], outputDir: null, quality: 'balanced', busy: false, results: new Map() };
  const queueEl = $('#queue');
  const emptyEl = $('#queue-empty');
  const errorEl = $('#error-message');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  function formatDuration(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function formatSize(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  function renderQueue() {
    queueEl.replaceChildren();
    $('#queue-count').textContent = String(state.files.length);
    emptyEl.classList.toggle('hidden', state.files.length > 0);
    $('#clear-queue').disabled = !state.files.length || state.busy;
    $('#add-files').disabled = state.busy;
    $('#browse-files').disabled = state.busy;
    $('#drop-zone').classList.toggle('disabled', state.busy);
    $('#start-button').disabled = !state.files.length || !state.outputDir || state.busy;
    for (const [index, file] of state.files.entries()) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>';
      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = file.name || file.path.split(/[\\/]/).pop() || 'Video';
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      const parts = [];
      if (file.width && file.height) parts.push(`${file.width} × ${file.height}`);
      if (file.fps) parts.push(`${Number(file.fps).toFixed(0)} fps`);
      if (file.duration) parts.push(formatDuration(file.duration));
      if (file.size) parts.push(formatSize(file.size));
      if (!parts.length) parts.push('Ready to process');
      for (const text of parts) {
        const span = document.createElement('span');
        span.textContent = text;
        meta.append(span);
      }
      info.append(name, meta);
      const remove = document.createElement('button');
      remove.className = 'remove-file';
      remove.type = 'button';
      remove.disabled = state.busy;
      remove.setAttribute('aria-label', `Remove ${name.textContent}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      remove.addEventListener('click', () => {
        state.files.splice(index, 1);
        renderQueue();
      });
      row.append(icon, info, remove);
      queueEl.append(row);
    }
  }
  function addFiles(items) {
    if (!items?.length || state.busy) return;
    const known = new Set(state.files.map((file) => file.path));
    const fresh = items.filter((file) => file?.path && !known.has(file.path));
    state.files.push(...fresh);
    clearError();
    renderQueue();
  }
  async function chooseFiles() {
    if (state.busy) return;
    clearError();
    try {
      if (!api?.pickFiles) throw new Error('The file picker is unavailable. Restart NX Motion and try again.');
      addFiles(await api.pickFiles());
    } catch (error) {
      showError(error.message || 'Could not open the file picker.');
    }
  }
  $('#add-files').addEventListener('click', chooseFiles);
  $('#browse-files').addEventListener('click', (event) => {
    event.stopPropagation();
    chooseFiles();
  });
  $('#drop-zone').addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    chooseFiles();
  });
  $('#drop-zone').addEventListener('keydown', (event) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      chooseFiles();
    }
  });
  for (const eventName of ['dragenter', 'dragover']) {
    $('#drop-zone').addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.busy) $('#drop-zone').classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    $('#drop-zone').addEventListener(eventName, (event) => {
      event.preventDefault();
      $('#drop-zone').classList.remove('dragging');
    });
  }
  $('#drop-zone').addEventListener('drop', async (event) => {
    if (state.busy) return;
    const files = [...(event.dataTransfer?.files || [])];
    clearError();
    try {
      if (api?.droppedFiles) {
        const paths = await api.droppedFiles(files);
        if (api.inspect && paths?.length) addFiles(await api.inspect(paths));
        else if (paths?.length) showError('Video details could not be read. Try choosing the files instead.');
        else showError('No supported video files found.');
      } else {
        showError('Drag and drop is unavailable here. Choose videos with the Add videos button.');
      }
    } catch (error) {
      showError(error.message || 'Could not read the dropped files.');
    }
  });
  $('#clear-queue').addEventListener('click', () => {
    if (state.busy) return;
    state.files = [];
    renderQueue();
    clearError();
  });

  $('#fps-select').addEventListener('change', (event) => {
    const custom = event.target.value === 'custom';
    $('#custom-fps-wrap').classList.toggle('hidden', !custom);
    if (custom) $('#custom-fps').focus();
  });
  for (const button of document.querySelectorAll('.quality-card')) {
    button.addEventListener('click', () => {
      state.quality = button.dataset.quality;
      document.querySelectorAll('.quality-card').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', String(selected));
      });
    });
  }
  $('#output-picker').addEventListener('click', async () => {
    clearError();
    try {
      if (!api?.pickOutput) throw new Error('The folder picker is unavailable.');
      const folder = await api.pickOutput();
      if (!folder) return;
      state.outputDir = folder;
      $('#output-label').textContent = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
      $('#output-picker').title = folder;
      $('#output-subtitle').textContent = folder;
      renderQueue();
    } catch (error) {
      showError(error.message || 'Could not choose an output folder.');
    }
  });
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    $('#theme-toggle').setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
    try { localStorage.setItem('nx-motion-theme', next); } catch {}
  });
  try {
    const savedTheme = localStorage.getItem('nx-motion-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
  } catch {}

  function onProgress(event = {}) {
    const total = Math.max(1, Number(event.total) || state.files.length);
    const index = Math.max(0, Number(event.index) || 0);
    const itemProgress = Math.max(0, Math.min(1, Number(event.progress) || 0));
    const overall = event.status === 'complete' ? 100 : Math.round(Math.min(100, ((index + itemProgress) / total) * 100));
    $('#progress-panel').classList.remove('hidden');
    $('#progress-bar').style.width = `${overall}%`;
    $('#progress-percent').textContent = `${overall}%`;
    const failed = [...state.results.values()].filter((result) => result.status === 'error').length;
    const completed = [...state.results.values()].filter((result) => result.status === 'done').length;
    $('#progress-title').textContent = event.status === 'complete' ? failed ? `${completed} ready · ${failed} failed` : 'Your videos are ready' : event.status === 'cancelled' ? 'Processing cancelled' : event.status === 'error' && !event.file ? 'Processing stopped with an error' : event.status === 'done' ? 'Finishing up…' : 'Making your video smoother…';
    $('#progress-file').textContent = event.file || 'Preparing your videos';
    $('#progress-status').textContent = event.status === 'processing' ? `${Math.round(itemProgress * 100)}% for this video` : event.status === 'cancelled' ? 'You can start again whenever you like.' : event.status === 'error' ? event.error || 'This video could not be processed.' : event.status === 'complete' ? failed ? 'Review the results below.' : 'Find your output below.' : `${Math.min(index + 1, total)} of ${total} videos`;
    if (event.file && ['done', 'error', 'cancelled'].includes(event.status)) {
      state.results.set(`${event.file}-${index}`, { ...event, total });
      renderResults();
    }
    if (event.status === 'complete' || event.status === 'cancelled' || (event.status === 'error' && !event.file)) finishProcessing();
  }
  function renderResults() {
    const container = $('#results');
    container.replaceChildren();
    for (const result of state.results.values()) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = result.file;
      const status = document.createElement('span');
      status.className = `result-status${result.status === 'error' ? ' error' : ''}`;
      status.textContent = result.status === 'done' ? 'Ready' : result.status === 'cancelled' ? 'Cancelled' : result.error || 'Could not process';
      row.append(name, status);
      if (result.output && api?.reveal) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'reveal-button';
        reveal.textContent = 'Show file';
        reveal.addEventListener('click', () => api.reveal(result.output));
        row.append(reveal);
      }
      container.append(row);
    }
  }
  function finishProcessing() {
    state.busy = false;
    $('#start-button').classList.remove('hidden');
    $('#cancel-button').classList.add('hidden');
    renderQueue();
  }
  if (api?.onProgress) api.onProgress(onProgress);

  $('#start-button').addEventListener('click', async () => {
    if (state.busy || !state.files.length) return;
    clearError();
    state.results.clear();
    $('#results').replaceChildren();
    $('#progress-panel').classList.remove('hidden');
    $('#progress-bar').style.width = '0%';
    $('#progress-percent').textContent = '0%';
    $('#progress-title').textContent = 'Getting things ready…';
    $('#progress-file').textContent = 'Preparing your videos';
    $('#progress-status').textContent = 'This may take a little while.';
    const selectedRate = $('#fps-select').value;
    const fps = selectedRate === 'custom' ? Number($('#custom-fps').value) : Number(selectedRate);
    if (!Number.isInteger(fps) || fps < 24 || fps > 240) {
      showError('Choose a frame rate from 24 to 240 fps.');
      return;
    }
    if (!api?.start) {
      showError('The processing engine is unavailable. Restart NX Motion and try again.');
      return;
    }
    state.busy = true;
    renderQueue();
    $('#start-button').classList.add('hidden');
    $('#cancel-button').classList.remove('hidden');
    try {
      const result = await api.start({
        files: state.files.map((file) => file.path),
        outputDir: state.outputDir,
        options: {
          fps,
          quality: state.quality,
          crf: state.quality === 'high' ? 17 : state.quality === 'fast' ? 24 : 20,
          resolution: $('#resolution').value,
          audio: $('#audio-toggle').checked,
          ...($('#preview-toggle').checked ? { previewSeconds: 5 } : {}),
        },
      });
      if (result?.ok === false) throw new Error(result.error || 'Processing could not start.');
    } catch (error) {
      finishProcessing();
      showError(error.message || 'Processing could not start.');
    }
  });
  $('#cancel-button').addEventListener('click', async () => {
    if (!state.busy) return;
    $('#cancel-button').disabled = true;
    $('#cancel-button').textContent = 'Cancelling…';
    try {
      if (!api?.cancel) throw new Error('Cancel is unavailable while processing.');
      await api.cancel();
    } catch (error) {
      showError(error.message || 'Could not cancel processing.');
    } finally {
      $('#cancel-button').disabled = false;
      $('#cancel-button').textContent = 'Cancel processing';
    }
  });
  renderQueue();
})();
