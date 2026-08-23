// PROTOTYPE — throwaway. The state is intentionally in memory and the harness commands never run.

const VARIANTS = {
  A: { name: 'Dedicated Run road', defaultView: 'automation' },
  B: { name: 'Context where it matters', defaultView: 'overview' },
  C: { name: 'Run lane on the map', defaultView: 'project' },
}

const SCENARIOS = {
  mixed: 'Mixed live states',
  invalid: 'Invalid global configuration',
  noFrontier: 'Active map · no AFK frontier',
  interrupted: 'Interrupted after restart',
}

const PROJECTS = [
  { id: 'roadmap', name: 'Roadmap', locator: 'asmundwien/roadmap', connection: 'GitHub Private' },
  { id: 'gainstage', name: 'Gainstage', locator: 'asmundwien/gainstage', connection: 'GitHub Private' },
  { id: 'agentlens', name: 'Agentlens', locator: 'asmundwien/agentlens', connection: 'GitHub Private' },
  { id: 'knip', name: 'Knip.NET', locator: 'felleskomponenter/knip-net', connection: 'GitHub Private' },
]

const RUN_SEED = [
  {
    id: 'run-1042',
    state: 'active',
    kind: 'Execution',
    project: 'Roadmap',
    projectId: 'roadmap',
    ticket: 'Supervise Run processes through terminal exit',
    ticketId: 'Automation map · task',
    source: 'Harness-backed',
    verdict: 'AFK',
    command: 'omp wayfinder execute --prompt-stdin',
    started: '10:31:08',
    result: 'Process 88401 · running for 02:17',
    output: [
      'Claimed “Supervise Run processes through terminal exit”',
      'Loading map “Roadmap v7: autonomous Wayfinder execution”',
      'Inspecting process supervisor seam',
      'Writing interruption-recovery scenario',
      'Running focused process tests…',
      '18 passed · waiting for harness terminal exit',
    ],
  },
  {
    id: 'run-1041',
    state: 'waiting',
    kind: 'Classification',
    project: 'Gainstage',
    projectId: 'gainstage',
    ticket: 'Choose the recording review threshold',
    ticketId: 'Active map · task',
    source: 'Harness-backed',
    verdict: 'HITL',
    command: 'omp wayfinder classify --prompt {prompt}',
    started: '10:27:44',
    result: 'Verdict HITL · human judgement required',
    output: ['{"verdict":"HITL","reason":"Requires the course owner to choose a quality bar."}'],
  },
  {
    id: 'run-1040',
    state: 'failed',
    kind: 'Execution',
    project: 'Agentlens',
    projectId: 'agentlens',
    ticket: 'Trace the imported session boundary',
    ticketId: 'Active map · research',
    source: 'Harness-backed',
    verdict: 'AFK',
    command: 'omp wayfinder execute --prompt-stdin',
    started: '10:16:02',
    result: 'Exit 1 after 01:42',
    output: ['Reading session fixtures', 'Error: expected workspace file was not readable', 'Harness exited 1'],
  },
  {
    id: 'run-1039',
    state: 'skipped',
    kind: 'Execution',
    project: 'Roadmap',
    projectId: 'roadmap',
    ticket: 'Prototype command editing',
    ticketId: 'Automation map · prototype',
    source: 'Harness-backed',
    verdict: 'AFK',
    command: 'omp wayfinder execute --prompt-stdin',
    started: '09:58:10',
    result: 'Skipped · another actor claimed first',
    output: ['Reconciled ticket', 'Claim lost to @asmundwien', 'No harness work performed'],
  },
  {
    id: 'run-1038',
    state: 'stopped',
    kind: 'Execution',
    project: 'Knip.NET',
    projectId: 'knip',
    ticket: 'Review generated API surface',
    ticketId: 'Active map · task',
    source: 'Harness-backed',
    verdict: 'AFK',
    command: 'omp wayfinder execute --prompt-stdin',
    started: '09:41:25',
    result: 'Stopped by user · signal TERM · exit 143',
    output: ['Reviewing API exports', 'Stop requested', 'Process exited after TERM'],
  },
  {
    id: 'run-1037',
    state: 'interrupted',
    kind: 'Execution',
    project: 'Gainstage',
    projectId: 'gainstage',
    ticket: 'Normalize lesson source material',
    ticketId: 'Active map · task',
    source: 'Harness-backed',
    verdict: 'AFK',
    command: 'omp wayfinder execute --prompt-stdin',
    started: 'Yesterday 18:22',
    result: 'Server restarted · process ownership unknown',
    output: ['Last captured before Roadmap stopped', 'No terminal result was observed'],
  },
  {
    id: 'run-1036',
    state: 'stopped',
    kind: 'Classification',
    project: 'Roadmap',
    projectId: 'roadmap',
    ticket: 'Research process-group semantics',
    ticketId: 'Automation map · research',
    source: 'Deterministic',
    verdict: 'AFK',
    command: 'Roadmap deterministic rule · research → AFK',
    started: 'Yesterday 17:50',
    result: 'Verdict AFK · no process launched',
    output: ['Known ticket type “research” resolved deterministically.'],
  },
]

const params = new URLSearchParams(window.location.search)
const requestedVariant = params.get('variant')
const variant = requestedVariant && VARIANTS[requestedVariant] ? requestedVariant : 'A'
let state = makeState(variant, 'mixed')

function makeState(variantKey, scenario) {
  const runs = structuredClone(RUN_SEED)
  const next = {
    variant: variantKey,
    view: VARIANTS[variantKey].defaultView,
    scenario,
    master: true,
    ceiling: 2,
    configurationValid: true,
    configurationError: '',
    commands: {
      classification: 'omp wayfinder classify --prompt {prompt}',
      execution: 'omp wayfinder execute --prompt-stdin',
    },
    enabled: { roadmap: true, gainstage: true, agentlens: false, knip: true },
    selectedRun: 'run-1042',
    runs,
    notice: '',
  }

  if (scenario === 'invalid') {
    next.configurationValid = false
    next.configurationError = 'automation.executionCommand.executable must not be empty.'
    next.commands.execution = ''
  }
  if (scenario === 'noFrontier') {
    next.runs = runs.filter((run) => run.state !== 'active')
    next.selectedRun = 'run-1041'
  }
  if (scenario === 'interrupted') {
    const interrupted = runs.find((run) => run.state === 'interrupted')
    next.runs = interrupted ? [interrupted, ...runs.filter((run) => run.id !== interrupted.id)] : runs
    next.selectedRun = 'run-1037'
  }
  return next
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function stateWord(runState) {
  return {
    active: 'Active',
    waiting: 'Waiting for human',
    failed: 'Failed',
    skipped: 'Skipped',
    stopped: 'Stopped',
    interrupted: 'Interrupted',
    ready: 'Ready',
  }[runState]
}

function stateGlyph(runState) {
  return {
    active: '▶',
    waiting: '◇',
    failed: '×',
    skipped: '○',
    stopped: '■',
    interrupted: '!',
    ready: '●',
  }[runState]
}

function currentRun() {
  return state.runs.find((run) => run.id === state.selectedRun) ?? state.runs[0]
}

function header() {
  const showAutomation = state.variant !== 'B'
  const attention = !state.configurationValid || state.runs.some((run) => ['failed', 'interrupted'].includes(run.state))
  return `
    <header class="site-header">
      <span class="brand"><span class="brand-mark">⌁</span>Roadmap</span>
      <nav class="site-nav" aria-label="Primary navigation">
        <button type="button" data-action="nav" data-view="overview" class="${state.view === 'overview' ? 'is-current' : ''}">Overview</button>
        <button type="button" data-action="nav" data-view="projects" class="${state.view === 'projects' ? 'is-current' : ''}">Projects</button>
        ${showAutomation ? `<button type="button" data-action="nav" data-view="automation" class="${state.view === 'automation' ? 'is-current' : ''}">Automation</button>` : ''}
      </nav>
      <span class="live"><i class="live-dot ${!state.master ? 'is-off' : attention ? 'is-attention' : ''}"></i>${!state.master ? 'Automation paused' : attention ? 'Automation · attention' : 'Live · automation on'}</span>
    </header>`
}

function prototypeBar() {
  return `
    <div class="prototype-bar">
      <strong>Prototype</strong>
      <span>No command runs. State resets on reload.</span>
      <label>Scenario
        <select data-action="scenario" aria-label="Prototype scenario">
          ${Object.entries(SCENARIOS).map(([key, label]) => `<option value="${key}" ${state.scenario === key ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    </div>`
}

function masterControl() {
  return `
    <div class="master">
      <button class="switch" type="button" role="switch" aria-label="Allow new automation Runs" aria-checked="${state.master}" data-action="master"></button>
      <span class="master-copy"><strong>${state.master ? 'Automation on' : 'Automation paused'}</strong><small>${state.master ? 'New Runs may start' : 'Active Runs finish; no new Runs start'}</small></span>
      <label class="ceiling">At most
        <select data-action="ceiling" aria-label="Maximum concurrent Projects" ${!state.master ? 'disabled' : ''}>
          ${[1, 2, 3, 4].map((value) => `<option ${state.ceiling === value ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
        Projects
      </label>
    </div>`
}

function configurationAlert() {
  if (state.configurationValid) return ''
  return `<div class="alert" role="alert"><strong>Automation configuration needs repair.</strong><span>${escapeHtml(state.configurationError)} No new Runs can start; active Runs continue.</span></div>`
}

function scenarioNotice() {
  if (state.scenario === 'noFrontier') {
    return `<div class="alert is-info"><strong>Roadmap has no executable frontier.</strong><span>The Active map has three unclaimed tickets, all waiting for human decisions. Automation remains enabled and idle.</span></div>`
  }
  if (state.scenario === 'interrupted') {
    return `<div class="alert"><strong>Gainstage needs acknowledgement.</strong><span>Roadmap restarted without observing the prior process exit. This Project will not resume until the interrupted Run is dismissed or retried.</span></div>`
  }
  return ''
}

function commandEditor() {
  return `
    <p class="eyebrow">Harness commands · global</p>
    <div class="command-grid">
      <label for="classification-command">Classification</label>
      <input id="classification-command" value="${escapeHtml(state.commands.classification)}" spellcheck="false" />
      <button class="button" type="button" data-action="save-command" data-kind="classification">Save</button>
    </div>
    <div class="command-grid">
      <label for="execution-command">Execution</label>
      <input id="execution-command" value="${escapeHtml(state.commands.execution)}" spellcheck="false" placeholder="Executable and arguments" />
      <button class="button" type="button" data-action="save-command" data-kind="execution">Save</button>
    </div>
    ${state.configurationError ? `<p class="command-error">${escapeHtml(state.configurationError)}</p>` : ''}`
}

function projectToggles() {
  return `
    <p class="eyebrow">Enabled Projects</p>
    ${PROJECTS.map((project) => `
      <div class="project-toggle">
        <p><strong>${project.name}</strong><small>${project.locator} · ${project.connection}</small></p>
        <button class="switch" type="button" role="switch" aria-label="Enable automation for ${project.name}" aria-checked="${state.enabled[project.id]}" data-action="project-toggle" data-project="${project.id}" ${!state.master ? 'disabled' : ''}></button>
      </div>`).join('')}`
}

function runRow(run, emphasis = false) {
  const attention = ['failed', 'interrupted'].includes(run.state)
  return `
    <button type="button" class="road-row ${emphasis ? 'is-emphasis' : ''} ${state.selectedRun === run.id ? 'is-selected' : ''}" data-action="select-run" data-run="${run.id}">
      <span class="node is-${run.state}" aria-hidden="true">${stateGlyph(run.state)}</span>
      <span class="row-copy"><strong>${escapeHtml(run.ticket)}</strong><span>${run.project} · ${run.kind} · ${run.source}${run.verdict ? ` · ${run.verdict}` : ''}</span></span>
      <span class="row-tail ${attention ? 'is-attention' : ''}">${stateWord(run.state)} · ${run.started}</span>
    </button>`
}

function runActions(run) {
  const canRetry = ['failed', 'stopped', 'interrupted'].includes(run.state)
  const canDismiss = ['waiting', 'failed', 'skipped', 'stopped', 'interrupted'].includes(run.state)
  return `
    <div class="control-strip">
      ${run.state === 'active' ? '<button class="button is-danger" type="button" data-action="stop">Stop</button>' : ''}
      ${canRetry ? '<button class="button is-strong" type="button" data-action="retry">Retry</button>' : ''}
      ${canDismiss ? '<button class="button" type="button" data-action="dismiss">Dismiss</button>' : ''}
      <button class="button" type="button" data-action="reclassify">Reclassify</button>
      <button class="button" type="button" data-action="override" data-verdict="AFK">Set AFK</button>
      <button class="button" type="button" data-action="override" data-verdict="HITL">Set HITL</button>
    </div>`
}

function runPanel(run, title = 'Run detail') {
  if (!run) return `<aside class="panel"><p class="muted">Select a Run.</p></aside>`
  return `
    <aside class="panel" aria-label="Run details">
      <div class="panel-nav"><button type="button" aria-label="Previous Run">↑</button><button type="button" aria-label="Next Run">↓</button><button type="button" aria-label="Close Panel">»</button></div>
      <p class="eyebrow">${title} · ${run.id}</p>
      <h2>${escapeHtml(run.ticket)}</h2>
      <p class="panel-state"><span class="node is-${run.state}" style="display:inline-grid;width:17px;height:17px;margin-right:.35rem">${stateGlyph(run.state)}</span>${stateWord(run.state)} · ${run.kind}</p>
      ${state.notice ? `<div class="alert is-info"><strong>${escapeHtml(state.notice)}</strong></div>` : ''}
      <dl class="facts">
        <dt>Project</dt><dd>${run.project}</dd>
        <dt>Classification</dt><dd>${run.verdict} · ${run.source}</dd>
        <dt>Started</dt><dd>${run.started}</dd>
        <dt>Result</dt><dd>${escapeHtml(run.result)}</dd>
        <dt>Command identity</dt><dd>${escapeHtml(run.command)}</dd>
      </dl>
      ${runActions(run)}
      <hr class="panel-rule" />
      <p class="eyebrow">Bounded output</p>
      <pre class="output">${escapeHtml(run.output.join('\n'))}</pre>
      <p class="output-limit">Showing retained tail · 200 lines / 48 KB maximum · earlier output discarded</p>
    </aside>`
}

function dedicatedAutomation() {
  const selected = currentRun()
  return `
    <main class="shell">
      <header class="page-head">
        <div><p class="eyebrow">Settings</p><h1>Automation</h1><p class="muted">One serial lane per Project · ${state.ceiling} may run at once</p></div>
        ${masterControl()}
      </header>
      ${configurationAlert()}${scenarioNotice()}
      <div class="split">
        <section class="road" aria-label="Run history">
          <p class="section-label">Now</p>
          ${state.runs.filter((run) => ['active', 'waiting', 'failed', 'interrupted'].includes(run.state)).map((run) => runRow(run, run.state === 'active')).join('') || '<p class="muted" style="margin-left:6rem">No Project lane is active.</p>'}
          <p class="section-label">Run history · newest first</p>
          ${state.runs.filter((run) => !['active', 'waiting', 'failed', 'interrupted'].includes(run.state)).map((run) => runRow(run)).join('')}
        </section>
        ${runPanel(selected)}
      </div>
      <hr class="panel-rule" />
      ${commandEditor()}
      <div style="margin-top:2rem">${projectToggles()}</div>
    </main>`
}

function attentionRuns() {
  return state.runs.filter((run) => ['waiting', 'failed', 'interrupted'].includes(run.state))
}

function contextualOverview() {
  const selected = currentRun()
  const active = state.runs.find((run) => run.state === 'active')
  return `
    <main class="shell variant-b">
      <header class="page-head"><div><h1>Roadmap</h1><p class="muted">The whole of things · automation stays contextual</p></div></header>
      ${configurationAlert()}${scenarioNotice()}
      <div class="context-band">
        <span class="node ${state.master ? 'is-ready' : 'is-stopped'}">${state.master ? '●' : '■'}</span>
        <span class="row-copy"><strong>${state.master ? `${state.ceiling} Project lanes available` : 'Automation paused'}</strong><span>${active ? `${active.project} is executing · other Projects remain readable` : 'No active Run'}</span></span>
        <button class="button" type="button" data-action="nav" data-view="projects">Settings</button>
      </div>
      <div class="split">
        <section class="road">
          <p class="section-label">Needs attention</p>
          ${attentionRuns().map((run) => runRow(run)).join('') || '<p class="muted" style="margin-left:6rem">Nothing needs attention.</p>'}
          <p class="section-label">Active work · priority</p>
          <button class="road-row is-emphasis" type="button" data-action="open-project" data-project="roadmap">
            <span class="node is-active">⚑</span><span class="row-copy"><strong>Roadmap v7: autonomous Wayfinder execution</strong><span>Roadmap · 2 decided · 6 open · fog ahead</span></span><span class="row-tail">${active ? 'Executing · 02:17' : 'Enabled · idle'}</span>
          </button>
          <button class="road-row" type="button" data-action="open-project" data-project="gainstage">
            <span class="node is-waiting">◇</span><span class="row-copy"><strong>Ship the first reviewed course</strong><span>Gainstage · human boundary at frontier</span></span><span class="row-tail">Waiting for human</span>
          </button>
          <p class="section-label">Projects at rest</p>
          <button class="road-row" type="button"><span class="node is-stopped">✓</span><span class="row-copy"><strong>Knip.NET</strong><span>All 3 maps closed · automation enabled</span></span><span class="row-tail">At rest</span></button>
        </section>
        ${runPanel(selected, 'Project attention')}
      </div>
    </main>`
}

function projectSettings() {
  const project = PROJECTS[0]
  return `
    <main class="shell">
      <header class="page-head"><div><p class="eyebrow">Settings</p><h1>Projects</h1><p class="muted">4 registered</p></div>${state.variant === 'B' ? masterControl() : ''}</header>
      ${configurationAlert()}${scenarioNotice()}
      ${state.variant === 'B' ? `<section style="margin-bottom:2.5rem">${commandEditor()}</section>` : ''}
      <div class="split">
        <section class="road">
          ${PROJECTS.map((item) => `
            <button type="button" class="road-row ${item.id === project.id ? 'is-selected' : ''}">
              <span class="node ${state.enabled[item.id] ? 'is-ready' : 'is-skipped'}">${state.enabled[item.id] ? '●' : '○'}</span>
              <span class="row-copy"><strong>${item.name}</strong><span>${item.locator}</span></span>
              <span class="row-tail">${state.enabled[item.id] ? 'Automation enabled' : 'Manual only'}</span>
            </button>`).join('')}
        </section>
        <aside class="panel">
          <p class="eyebrow">Project registration · GitHub</p><h2>${project.name}</h2>
          <div class="alert is-info"><strong>${state.enabled.roadmap ? 'Automation enabled.' : 'Manual only.'}</strong><span>${state.enabled.roadmap ? 'Only this Project’s Active map may advance.' : 'Roadmap will not start new Runs for this Project.'}</span></div>
          <dl class="facts"><dt>Connection</dt><dd>GitHub Private</dd><dt>Workspace</dt><dd>/source/private/roadmap</dd><dt>Active map</dt><dd>Autonomous Wayfinder execution</dd><dt>Executable frontier</dt><dd>${state.scenario === 'noFrontier' ? 'None · 3 HITL tickets' : '2 AFK tickets'}</dd></dl>
          <div class="project-toggle"><p><strong>Advance Active map</strong><small>Global commands; no Project overrides</small></p><button class="switch" role="switch" type="button" aria-checked="${state.enabled.roadmap}" data-action="project-toggle" data-project="roadmap"></button></div>
          <div class="control-strip" style="margin-top:1rem"><button class="button" type="button" data-action="select-project-history">View Run history</button></div>
        </aside>
      </div>
    </main>`
}

function mapLane() {
  const selected = currentRun()
  const active = state.runs.find((run) => run.state === 'active')
  const laneState = state.scenario === 'noFrontier' ? 'No AFK frontier' : active ? `${active.kind} · ${active.state}` : 'Lane available'
  return `
    <main class="shell">
      <p class="small"><button class="button" type="button" data-action="nav" data-view="overview">← All projects</button></p>
      ${configurationAlert()}${scenarioNotice()}
      <header class="page-head"><div><h1>Roadmap <span class="badge">GitHub</span></h1><p class="muted">1 map open · 6 closed</p></div><div class="master"><span class="master-copy"><strong>${state.enabled.roadmap ? 'Project enabled' : 'Manual only'}</strong><small>${laneState}</small></span><button class="switch" type="button" role="switch" aria-label="Enable Roadmap automation" aria-checked="${state.enabled.roadmap}" data-action="project-toggle" data-project="roadmap"></button></div></header>
      <div class="map-frame">
        <section class="map-main" aria-label="Active map with Run lane">
          <div class="destination"><span class="flag">⚑</span><span><span class="eyebrow">Destination</span><strong>Roadmap advances Active Wayfinder maps autonomously and stops at human boundaries.</strong></span></div>
          <div class="ledger-head"><span></span><span>Frontier and ground covered</span><span>Project Run lane</span></div>
          ${ledgerTicket('Prototype Automation settings and Run history', 'prototype', 'claimed', active ? `${active.kind} · 02:17` : null, active?.id)}
          ${ledgerTicket('Supervise Run processes through terminal exit', 'task', 'frontier', state.scenario === 'noFrontier' ? null : 'Next · AFK', 'run-1042')}
          ${ledgerTicket('Choose interruption acknowledgement semantics', 'grilling', 'frontier', 'Human boundary', 'run-1037', true)}
          ${ledgerTicket('The harness contract — commands, prompts, and results', 'grilling', 'closed', 'Classified · HITL', 'run-1041')}
          ${ledgerTicket('Supervising configurable agent processes safely', 'research', 'closed', 'Deterministic · AFK', 'run-1036')}
        </section>
        <div class="map-panel">${runPanel(selected, 'Run on this map')}</div>
      </div>
    </main>`
}

function ledgerTicket(title, type, ticketState, lane, runId, attention = false) {
  const glyph = { claimed: '●', frontier: '○', closed: '✓' }[ticketState]
  return `
    <div class="ledger-ticket">
      <span class="node ${ticketState === 'claimed' ? 'is-active' : ticketState === 'closed' ? 'is-stopped' : 'is-ready'}" style="z-index:1">${glyph}</span>
      <button type="button" data-action="select-run" data-run="${runId}"><strong>${title}</strong><br><span class="muted small">${type} · ${ticketState}</span></button>
      ${lane ? `<button type="button" class="run-lane ${attention ? 'is-attention' : ''}" data-action="select-run" data-run="${runId}"><i></i><span>${lane}</span></button>` : `<span class="run-lane is-empty">${state.scenario === 'noFrontier' ? 'Not executable' : 'No Run'}</span>`}
    </div>`
}

function automationSettings() {
  return `
    <main class="shell">
      <header class="page-head"><div><p class="eyebrow">Settings</p><h1>Automation</h1><p class="muted">Global limits and two Harness Commands</p></div>${masterControl()}</header>
      ${configurationAlert()}${scenarioNotice()}
      ${commandEditor()}
      <hr class="panel-rule" />
      ${projectToggles()}
    </main>`
}

function commonOverview() {
  return contextualOverview()
}

function content() {
  if (state.view === 'projects') return projectSettings()
  if (state.view === 'automation') return state.variant === 'A' ? dedicatedAutomation() : automationSettings()
  if (state.view === 'project') return state.variant === 'C' ? mapLane() : contextualOverview()
  if (state.variant === 'B') return contextualOverview()
  if (state.variant === 'C') return commonOverview()
  return commonOverview()
}

function switcher() {
  return `
    <div class="variant-switcher" role="toolbar" aria-label="Prototype variants">
      <button type="button" data-action="variant" data-direction="-1" aria-label="Previous variant">←</button>
      <span class="variant-label"><strong>${state.variant}</strong> ${VARIANTS[state.variant].name}</span>
      <button type="button" data-action="variant" data-direction="1" aria-label="Next variant">→</button>
    </div>`
}

function render() {
  document.querySelector('#app').innerHTML = `<div class="variant-${state.variant.toLowerCase()}">${header()}${prototypeBar()}${content()}</div>${switcher()}`
}

function updateVariant(direction) {
  const keys = Object.keys(VARIANTS)
  const at = keys.indexOf(state.variant)
  const next = keys[(at + direction + keys.length) % keys.length]
  const url = new URL(window.location.href)
  url.searchParams.set('variant', next)
  window.location.assign(url)
}

function handleAction(target) {
  const action = target.dataset.action
  if (action === 'variant') updateVariant(Number(target.dataset.direction))
  if (action === 'nav') {
    state.view = target.dataset.view
    state.notice = ''
    render()
  }
  if (action === 'open-project') {
    state.view = state.variant === 'C' ? 'project' : 'overview'
    state.notice = 'Project selected. Its Run state stays contextual.'
    render()
  }
  if (action === 'master') {
    state.master = !state.master
    state.notice = state.master ? 'Automation resumed.' : 'Automation paused. Active Runs may finish.'
    render()
  }
  if (action === 'project-toggle') {
    const project = target.dataset.project
    state.enabled[project] = !state.enabled[project]
    state.notice = `${PROJECTS.find((item) => item.id === project)?.name} is now ${state.enabled[project] ? 'enabled' : 'manual only'}.`
    render()
  }
  if (action === 'select-run') {
    state.selectedRun = target.dataset.run
    state.notice = ''
    render()
  }
  if (action === 'stop') {
    const run = currentRun()
    run.state = 'stopped'
    run.result = 'Stop requested · process exited after TERM · exit 143'
    run.output.push('Stop requested by user', 'Process exited after TERM')
    state.notice = 'Stopped after the harness process exited.'
    render()
  }
  if (action === 'retry') {
    const run = currentRun()
    run.state = 'active'
    run.started = 'just now'
    run.result = 'New attempt · process running'
    run.output = ['Retry started from the same ticket and current tracker state.']
    state.notice = 'Retry started. This Project lane is occupied until terminal exit.'
    render()
  }
  if (action === 'dismiss') {
    const run = currentRun()
    run.dismissed = true
    state.notice = 'Acknowledged. The durable Run remains in history; it leaves attention.'
    if (run.state === 'interrupted') run.state = 'stopped'
    render()
  }
  if (action === 'reclassify') {
    const run = currentRun()
    run.kind = 'Classification'
    run.state = run.ticketId.includes('research') ? 'stopped' : 'active'
    run.source = run.ticketId.includes('research') ? 'Deterministic' : 'Harness-backed'
    run.result = run.source === 'Deterministic' ? 'Verdict AFK · no process launched' : 'Classification process running'
    state.notice = run.source === 'Deterministic' ? 'Reclassified deterministically as AFK.' : 'Classification Run started.'
    render()
  }
  if (action === 'override') {
    const run = currentRun()
    run.verdict = target.dataset.verdict
    run.state = run.verdict === 'HITL' ? 'waiting' : 'stopped'
    run.result = `Verdict overridden to ${run.verdict}`
    state.notice = `${run.ticket} is now ${run.verdict}.`
    render()
  }
  if (action === 'save-command') {
    const kind = target.dataset.kind
    const input = document.querySelector(`#${kind}-command`)
    const value = input.value.trim()
    state.commands[kind] = value
    state.configurationValid = value.length > 0 && Object.values(state.commands).every(Boolean)
    state.configurationError = state.configurationValid ? '' : `automation.${kind}Command.executable must not be empty.`
    state.notice = state.configurationValid ? `${kind === 'classification' ? 'Classification' : 'Execution'} Harness Command saved.` : ''
    render()
  }
  if (action === 'select-project-history') {
    state.view = state.variant === 'A' ? 'automation' : state.variant === 'C' ? 'project' : 'overview'
    const run = state.runs.find((item) => item.projectId === 'roadmap')
    if (run) state.selectedRun = run.id
    render()
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]')
  if (target) handleAction(target)
})

document.addEventListener('change', (event) => {
  const target = event.target
  if (target.dataset.action === 'scenario') {
    state = makeState(state.variant, target.value)
    render()
  }
  if (target.dataset.action === 'ceiling') {
    state.ceiling = Number(target.value)
    state.notice = `Concurrency ceiling set to ${state.ceiling}. Active Runs are not stopped.`
    render()
  }
})

window.addEventListener('keydown', (event) => {
  const target = event.target
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'ArrowLeft') updateVariant(-1)
  if (event.key === 'ArrowRight') updateVariant(1)
})

render()
