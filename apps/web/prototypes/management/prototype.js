// PROTOTYPE ONLY. Question: which information hierarchy makes the full Connection and Project lifecycle understandable and safe?
const variants = [
  { key: 'A', name: 'Project ledger' },
  { key: 'B', name: 'Guided workbench' },
  { key: 'C', name: 'Connection terrain' },
  { key: 'D', name: 'Recommended hybrid' },
]

const state = {
  selectedProject: 'roadmap',
  selectedConnection: 'github-personal',
  ledgerTab: 'projects',
  hybridTab: 'projects',
  flow: null,
  notice: '',
  connections: [
    { id: 'local', name: 'Local', kind: 'local', health: 'healthy', builtIn: true, account: 'This Mac' },
    { id: 'github-personal', name: 'Personal GitHub', kind: 'github', health: 'healthy', account: '@asmundwien' },
    { id: 'github-work', name: 'Work GitHub', kind: 'github', health: 'expired', account: '@asmund-work' },
  ],
  projects: [
    { id: 'roadmap', name: 'Roadmap', connectionId: 'github-personal', locator: 'asmundwien/roadmap', workspace: '~/source/private/roadmap', maps: 1, mapState: 'active', destination: 'Self-managed projects and connections', ground: 1, open: 2, fog: true, availability: 'reachable' },
    { id: 'microsoft-risiko', name: 'Microsoft Risiko', connectionId: 'local', locator: '~/source/hdir/platform/microsoft-risiko', workspace: '~/source/hdir/platform/microsoft-risiko', maps: 2, mapState: 'resting', destination: '', ground: 17, open: 0, fog: false, availability: 'reachable' },
    { id: 'empty-lab', name: 'Empty Lab', connectionId: 'github-work', locator: 'asmund-work/empty-lab', workspace: '~/source/work/empty-lab', maps: 0, mapState: 'waiting', destination: '', ground: 0, open: 0, fog: false, availability: 'reachable' },
    { id: 'design-system', name: 'Design System', connectionId: 'github-personal', locator: 'asmundwien/design-system', workspace: '~/source/work/design-system', maps: 3, mapState: 'active', destination: 'Unify product foundations across the suite', ground: 6, open: 3, fog: true, availability: 'unreachable' },
  ],
  activity: [
    'Work GitHub needs authorization',
    'Design System became unreachable',
    'Roadmap reconciled 2 minutes ago',
  ],
}

function variantFromUrl() {
  const requested = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return variants.some((variant) => variant.key === requested) ? requested : 'D'
}

let currentVariant = variantFromUrl()
let currentPage = pageFromUrl()

function pageFromUrl() {
  const requested = new URLSearchParams(location.search).get('page')
  return ['home', 'projects', 'connections'].includes(requested) ? requested : 'home'
}

function connectionFor(project) {
  return state.connections.find((connection) => connection.id === project.connectionId)
}

function dependentsOf(connectionId) {
  return state.projects.filter((project) => project.connectionId === connectionId)
}

function integrationPill(connection) {
  return `<span class="pill ${connection.kind}">${connection.kind === 'github' ? 'GitHub' : 'Local'}</span>`
}

function statusLabel(value) {
  if (value === 'expired') return 'Authorization expired'
  if (value === 'unreachable') return 'Unreachable'
  return 'Healthy'
}

function projectState(project) {
  if (project.availability === 'unreachable') return '<span class="status unreachable">Unreachable</span>'
  if (project.maps === 0) return '<span class="status healthy">No Wayfinder maps yet</span>'
  return `<span class="status healthy">${project.maps} Wayfinder ${project.maps === 1 ? 'map' : 'maps'}</span>`
}

function shell(content) {
  const productionPreview = currentVariant === 'D'
  const variant = variants.find((candidate) => candidate.key === currentVariant)
  return `
    <header class="proto-header">
      ${productionPreview
        ? `<button class="brand brand-button" data-page="home"><span class="brand-mark">⚑</span> Roadmap</button>
          <nav class="product-nav" aria-label="Primary navigation">
            <button class="${currentPage === 'home' ? 'active' : ''}" data-page="home">Overview</button>
            <button class="${currentPage === 'projects' ? 'active' : ''}" data-page="projects">Projects</button>
            <button class="${currentPage === 'connections' ? 'active' : ''}" data-page="connections">Connections</button>
          </nav>`
        : '<div class="brand"><span class="brand-mark">⚑</span> Roadmap <span class="proto-tag">PROTOTYPE</span></div>'}
      <span class="live">Server live</span>
    </header>
    ${state.notice ? `<div class="page" style="padding-bottom:0"><div class="warning">${state.notice}</div></div>` : ''}
    ${content}
    ${state.flow ? renderFlow() : ''}
    ${productionPreview ? '' : `<details class="state-peek"><summary>Prototype state</summary><pre>${escapeHtml(JSON.stringify({ connections: state.connections, projects: state.projects }, null, 2))}</pre></details>
    <nav class="proto-switcher" aria-label="Prototype variants">
      <button data-cycle="-1" aria-label="Previous variant">←</button>
      <span class="proto-label">${variant.key} · ${variant.name}</span>
      <button data-cycle="1" aria-label="Next variant">→</button>
    </nav>`}
  `
}

function renderLedger() {
  const selectedProject = state.projects.find((project) => project.id === state.selectedProject) ?? state.projects[0]
  const selectedConnection = state.connections.find((connection) => connection.id === state.selectedConnection) ?? state.connections[0]
  const rows = state.ledgerTab === 'projects'
    ? state.projects.map((project) => {
        const connection = connectionFor(project)
        return `<button class="ledger-row ${project.id === selectedProject?.id ? 'selected' : ''}" data-select-project="${project.id}">
          <span><strong>${project.name}</strong><span class="muted small">${project.locator}</span></span>
          <span>${integrationPill(connection)} ${connection.name}</span>
          <span>${projectState(project)}</span>
          <span aria-hidden="true">›</span>
        </button>`
      }).join('')
    : state.connections.map((connection) => `<button class="ledger-row ${connection.id === selectedConnection?.id ? 'selected' : ''}" data-select-connection="${connection.id}">
        <span><strong>${connection.name}</strong><span class="muted small">${connection.account}</span></span>
        <span>${integrationPill(connection)}</span>
        <span class="status ${connection.health}">${statusLabel(connection.health)}</span>
        <span aria-hidden="true">›</span>
      </button>`).join('')

  return shell(`<main class="page">
    <div class="ledger-head">
      <div><p class="eyebrow">Manage Roadmap</p><h1>Projects first.</h1><p class="lede">Registrations stay central. Connection details appear when they affect a project.</p></div>
      <div class="actions"><button class="button" data-open="connection">Add connection</button><button class="button primary" data-open="project">Add project</button></div>
    </div>
    <div class="ledger-layout">
      <section class="card ledger-main">
        <div class="ledger-toolbar">
          <div class="segment"><button class="${state.ledgerTab === 'projects' ? 'active' : ''}" data-tab="projects">Projects</button><button class="${state.ledgerTab === 'connections' ? 'active' : ''}" data-tab="connections">Connections</button></div>
          <span class="muted small">${state.ledgerTab === 'projects' ? `${state.projects.length} registered` : `${state.connections.length} configured`}</span>
        </div>
        ${rows || '<p class="muted" style="padding:1rem">Nothing here yet.</p>'}
      </section>
      ${state.ledgerTab === 'projects' && selectedProject ? projectInspector(selectedProject) : connectionInspector(selectedConnection)}
    </div>
  </main>`)
}

function projectInspector(project) {
  const connection = connectionFor(project)
  return `<aside class="card ledger-inspector">
    <div class="inspector-kicker"><span class="eyebrow">Project registration</span>${integrationPill(connection)}</div>
    <h2>${project.name}</h2>
    ${project.maps === 0 ? '<p class="empty-note">No Wayfinder maps yet. The project stays registered and will appear here when its first map is created.</p>' : ''}
    ${project.availability === 'unreachable' ? '<p class="warning small">Roadmap cannot read this project now. Its registration and routes are unchanged.</p>' : ''}
    <dl class="inspector-list"><dt>Connection</dt><dd>${connection.name}</dd><dt>Locator</dt><dd>${project.locator}</dd><dt>Workspace</dt><dd>${project.workspace || 'Not set'}</dd><dt>Maps</dt><dd>${project.maps}</dd></dl>
    <div class="actions"><button class="button primary" data-edit-project="${project.id}">Edit registration</button><button class="button danger" data-remove-project="${project.id}">Remove</button></div>
    <p class="muted small" style="margin-top:1rem">Removing this registration never changes the repository.</p>
  </aside>`
}

function connectionInspector(connection) {
  const dependents = dependentsOf(connection.id)
  return `<aside class="card ledger-inspector">
    <div class="inspector-kicker"><span class="eyebrow">Connection</span>${integrationPill(connection)}</div>
    <h2>${connection.name}</h2>
    <p class="status ${connection.health}">${statusLabel(connection.health)}</p>
    <dl class="inspector-list"><dt>Account</dt><dd>${connection.account}</dd><dt>Projects</dt><dd>${dependents.length}</dd><dt>Removal</dt><dd>${connection.builtIn ? 'Built in' : dependents.length ? 'Dependencies must be handled' : 'Available'}</dd></dl>
    <div class="actions">${connection.health === 'expired' ? `<button class="button primary" data-reauthorize="${connection.id}">Authorize again</button>` : ''}${connection.builtIn ? '' : `<button class="button danger" data-remove-connection="${connection.id}">Remove connection</button>`}</div>
  </aside>`
}

function renderGuide() {
  const unhealthyConnections = state.connections.filter((connection) => connection.health !== 'healthy')
  const unavailableProjects = state.projects.filter((project) => project.availability !== 'reachable')
  const attentionCount = unhealthyConnections.length + unavailableProjects.length
  return shell(`<main class="page guide">
    <section class="guide-hero">
      <div><p class="eyebrow">Manage Roadmap</p><h1>What do you need to change?</h1><p class="lede">Start with the outcome. Roadmap asks for connection details only when the change needs them.</p></div>
      <div class="guide-summary"><div class="guide-stat"><strong>${state.projects.length}</strong><span class="muted small">projects</span></div><div class="guide-stat"><strong>${state.connections.length}</strong><span class="muted small">connections</span></div><div class="guide-stat"><strong>${attentionCount}</strong><span class="muted small">need attention</span></div></div>
    </section>
    <div class="guide-grid">
      <section class="task-deck" aria-label="Management actions">
        <button class="task-card" data-open="project"><span class="task-number">01</span><strong>Register a project</strong><span class="muted">Choose a connection, validate access, then save.</span></button>
        <button class="task-card" data-open="connection"><span class="task-number">02</span><strong>Connect GitHub</strong><span class="muted">Authorize another selected-repository GitHub account.</span></button>
        <button class="task-card" data-open="choose-project"><span class="task-number">03</span><strong>Change a project</strong><span class="muted">Rename, reassign, or update its optional workspace.</span></button>
        <button class="task-card" data-open="choose-connection"><span class="task-number">04</span><strong>Remove a connection</strong><span class="muted">See dependent projects before anything is removed.</span></button>
      </section>
      <aside class="card guide-activity">
        <p class="eyebrow">Needs attention</p>
        <h2>${attentionCount === 0 ? 'Everything is current' : `${attentionCount} ${attentionCount === 1 ? 'change needs' : 'changes need'} attention`}</h2>
        ${unhealthyConnections.map((connection) => `<div class="warning" style="margin-bottom:.75rem"><strong>${connection.name}</strong><p class="small" style="margin:.25rem 0 .65rem">${statusLabel(connection.health)}. Registered projects stay visible.</p><button class="button primary" data-reauthorize="${connection.id}">Authorize again</button></div>`).join('')}
        ${unavailableProjects.map((project) => `<div class="warning" style="margin-bottom:.75rem"><strong>${project.name}</strong><p class="small" style="margin:.25rem 0 .65rem">Roadmap cannot read this project. Its registration and routes are unchanged.</p><button class="button" data-edit-project="${project.id}">Review registration</button></div>`).join('')}
        ${attentionCount === 0 ? '<p class="muted">No connections or projects need attention.</p>' : ''}
        <p class="eyebrow" style="margin-top:1.25rem">Recent</p>
        ${state.activity.map((entry) => `<div class="activity-line"><span class="activity-dot"></span><span class="small">${entry}</span></div>`).join('')}
      </aside>
    </div>
  </main>`)
}

function connectionLanes(connectionPage = false) {
  return state.connections.map((connection) => {
    const projects = dependentsOf(connection.id)
    return `<section class="card lane ${connection.kind === 'local' ? 'local-lane' : ''}">
      <header class="lane-head">
        <div class="lane-title"><div><span class="eyebrow">${connection.kind === 'github' ? connection.account : 'Built in'}</span><h2 style="margin:0">${connection.name}</h2></div>${integrationPill(connection)}</div>
        <p class="status ${connection.health}" style="margin:.65rem 0 0">${statusLabel(connection.health)}</p>
      </header>
      <div>${projects.map((project) => `<button class="binding" ${connectionPage ? `data-go-project="${project.id}"` : `data-edit-project="${project.id}"`}><strong>${project.name}</strong><span class="muted small">${project.availability === 'unreachable' ? 'Unreachable' : project.maps === 0 ? 'No Wayfinder maps yet' : `${project.maps} ${project.maps === 1 ? 'map' : 'maps'}`}</span></button>`).join('') || '<p class="muted small" style="padding:1rem">No registered projects use this connection.</p>'}</div>
      <footer class="lane-foot">${connectionPage ? '' : `<button class="button" data-open-project-for="${connection.id}">Add project</button>`}${connection.builtIn ? '' : `<button class="button danger" data-remove-connection="${connection.id}">Remove</button>`}</footer>
    </section>`
  }).join('')
}

function renderTerrain() {
  return shell(`<main class="page">
    <div class="terrain-head"><p class="eyebrow">Manage Roadmap</p><h1>Connections carry projects.</h1><p class="lede">The layout makes every dependency visible. A project sits under the credential or local root Roadmap uses to reach it.</p><div class="terrain-actions"><button class="button primary" data-open="connection">Add connection</button><button class="button" data-open="project">Register project</button></div></div>
    <div class="connection-lanes">${connectionLanes()}<button class="add-lane" data-open="connection"><span><strong style="display:block;color:var(--fg)">＋ Add GitHub connection</strong>Authorize selected repositories</span></button></div>
  </main>`)
}

function renderProduct() {
  if (currentPage === 'projects') return renderProjectsPage()
  if (currentPage === 'connections') return renderConnectionsPage()
  return renderOverviewPage()
}

function renderOverviewPage() {
  const active = state.projects.filter((project) => project.mapState === 'active')
  const resting = state.projects.filter((project) => project.mapState === 'resting')
  const waiting = state.projects.filter((project) => project.mapState === 'waiting')
  const unhealthyConnections = state.connections.filter((connection) => connection.health !== 'healthy')
  const unreachableProjects = state.projects.filter((project) => project.availability !== 'reachable')
  const attention = unhealthyConnections.length + unreachableProjects.length
  return shell(`<main class="page product-shell">
    <header class="product-head">
      <h1>Roadmap</h1>
      <p class="muted">The whole of things · updated just now</p>
      <div class="product-legend"><span><i class="dot decided"></i>${state.projects.length} projects</span><span><i class="dot active"></i>${active.length} active</span><span><i class="dot resting"></i>${resting.length} at rest</span><span><i class="dot attention"></i>${attention} need attention</span></div>
    </header>
    <div class="portfolio-road">
      ${attention ? `<section class="road-section">
        <p class="road-section-label">needs attention</p>
        ${unhealthyConnections.map((connection) => `<button class="road-row" data-page="connections"><span class="road-node blocked">×</span><span class="road-copy"><strong>${connection.name} authorization expired</strong><span class="road-detail">Authorize this Connection again to refresh ${dependentsOf(connection.id).map((project) => project.name).join(', ')}.</span></span><span class="road-tail">Connection ›</span></button>`).join('')}
        ${unreachableProjects.map((project) => `<button class="road-row" data-go-project="${project.id}"><span class="road-node blocked">×</span><span class="road-copy"><strong>${project.name} repository unavailable</strong><span class="road-detail">${connectionFor(project).name} cannot access ${project.locator}.</span></span><span class="road-tail">Project ›</span></button>`).join('')}
      </section>` : ''}
      <section class="road-section">
        <p class="road-section-label">active work · priority</p>
        ${active.map((project) => `<article class="road-row map-row"><span class="road-node flag">⚑</span><span class="road-copy"><span class="road-kicker">${project.name} ${integrationPill(connectionFor(project))}</span><strong>${project.destination}</strong><span class="road-detail">${project.ground} decided · ${project.open} open${project.fog ? ' · fog ahead' : ''}</span></span><span class="road-tail ${project.availability === 'reachable' ? 'is-active' : 'is-unreachable'}">${project.availability === 'reachable' ? 'Active' : 'Unreachable'}</span></article>`).join('')}
      </section>
      <section class="road-section ground">
        <p class="road-section-label">at rest</p>
        ${resting.map((project) => `<article class="road-row"><span class="road-node closed">✓</span><span class="road-copy"><strong>${project.name}</strong><span class="road-detail">All ${project.maps} maps closed · ${project.ground} decisions recorded</span></span><span class="road-tail">Resting</span></article>`).join('') || '<p class="road-empty">No projects at rest.</p>'}
      </section>
      <section class="road-section waiting">
        <p class="road-section-label">waiting for a first map</p>
        ${waiting.map((project) => `<article class="road-row"><span class="road-node open">○</span><span class="road-copy"><strong>${project.name}</strong><span class="road-detail">Registered and reachable · no Wayfinder maps yet</span></span><span class="road-tail">Waiting</span></article>`).join('') || '<p class="road-empty">Every project has a Wayfinder map.</p>'}
      </section>
    </div>
  </main>`)
}

function projectRegistrationLinks(project, connection) {
  const workspace = project.workspace
  const sourceLabel = connection.kind === 'github' ? 'View repository on GitHub' : 'Open project folder'
  const sourceTarget = connection.kind === 'github' ? `https://github.com/${project.locator}` : project.locator
  return `<div class="registration-links"><p class="eyebrow">Open</p>
    <button class="registration-link" data-project-launch="vscode" data-project-id="${project.id}"><span><strong>Open workspace in VS Code</strong><small>${workspace}</small></span><span>↗</span></button>
    ${connection.kind === 'github' ? `<a class="registration-link" href="${sourceTarget}" target="_blank" rel="noreferrer"><span><strong>${sourceLabel}</strong><small>${project.locator}</small></span><span>↗</span></a>` : `<button class="registration-link" data-project-launch="folder" data-project-id="${project.id}"><span><strong>${sourceLabel}</strong><small>${sourceTarget}</small></span><span>↗</span></button>`}
    <button class="registration-link" data-open-project-view="${project.id}"><span><strong>Open project in Roadmap</strong><small>Maps, decisions, and active work</small></span><span>›</span></button>
  </div>`
}
function projectAlerts(project, connection) {
  const alerts = []
  if (connection.health === 'expired') alerts.push(`<div class="project-alert error" role="alert"><strong>Connection authorization expired</strong><span>${connection.name} must be authorized again before Roadmap can refresh this project.</span></div>`)
  if (project.availability === 'unreachable') alerts.push(`<div class="project-alert error" role="alert"><strong>Repository unavailable</strong><span>${connection.name} cannot access ${project.locator}.</span></div>`)
  if (project.maps === 0) alerts.push('<div class="project-alert info"><strong>No Wayfinder maps yet</strong><span>The local workspace exists and the project is registered, but it has no Wayfinder maps.</span></div>')
  return alerts.join('')
}


function renderProjectsPage() {
  const selectedProject = state.projects.find((project) => project.id === state.selectedProject) ?? state.projects[0]
  const projectRows = state.projects.map((project) => {
    const connection = connectionFor(project)
    const marker = project.availability === 'unreachable' ? 'blocked' : project.maps === 0 ? 'open' : project.mapState === 'resting' ? 'closed' : 'active'
    const glyph = marker === 'blocked' ? '×' : marker === 'closed' ? '✓' : marker === 'open' ? '○' : '●'
    return `<button class="settings-row ${project.id === selectedProject?.id ? 'selected' : ''}" data-select-project="${project.id}"><span class="road-node ${marker}">${glyph}</span><span class="road-copy"><strong>${project.name}</strong><span class="road-detail">${project.locator}</span></span><span class="settings-meta"><span>${integrationPill(connection)} ${connection.name}</span>${projectState(project)}</span></button>`
  }).join('')
  const connection = selectedProject ? connectionFor(selectedProject) : null
  return shell(`<main class="page product-shell">
    <div class="settings-head"><div><p class="eyebrow">Settings</p><h1>Projects</h1><p class="muted">${state.projects.length} registered</p></div><button class="button primary" data-open="project">Add project</button></div>
    <div class="settings-layout"><section class="settings-road">${projectRows}</section>${selectedProject ? `<aside class="settings-panel"><div class="inspector-kicker"><span class="eyebrow">Project registration</span>${integrationPill(connection)}</div><h2>${selectedProject.name}</h2>${projectAlerts(selectedProject, connection)}<dl class="inspector-list"><dt>Connection</dt><dd>${connection.name}</dd><dt>Locator</dt><dd>${selectedProject.locator}</dd><dt>Workspace</dt><dd>${selectedProject.workspace}</dd><dt>Maps</dt><dd>${selectedProject.maps}</dd></dl>${projectRegistrationLinks(selectedProject, connection)}<div class="actions"><button class="button primary" data-edit-project="${selectedProject.id}">Edit registration</button></div></aside>` : ''}</div>
  </main>`)
}

function renderConnectionsPage() {
  return shell(`<main class="page product-shell">
    <div class="settings-head"><div><p class="eyebrow">Settings</p><h1>Connections</h1><p class="muted">${state.connections.length} configured</p></div><button class="button primary" data-open="connection">Add connection</button></div>
    <div class="connection-road">${state.connections.map((connection) => {
      const projects = dependentsOf(connection.id)
      return `<section class="connection-stride"><div class="connection-main"><span class="road-node ${connection.health === 'healthy' ? 'active' : 'blocked'}">${connection.kind === 'local' ? 'L' : 'G'}</span><span class="road-copy"><span class="road-kicker">${connection.kind === 'github' ? connection.account : 'Built in'}</span><strong>${connection.name}</strong><span class="road-detail">${statusLabel(connection.health)} · ${projects.length} registered ${projects.length === 1 ? 'project' : 'projects'}</span></span><span class="connection-actions">${connection.health === 'expired' ? `<button class="button primary" data-reauthorize="${connection.id}">Authorize again</button>` : ''}${connection.builtIn ? '<span class="pill local">Built in</span>' : `<button class="button danger" data-remove-connection="${connection.id}">Remove</button>`}</span></div>${projects.map((project) => `<button class="dependency-row" data-go-project="${project.id}"><span class="branch-node"></span><span><strong>${project.name}</strong><span class="road-detail">${project.locator}</span></span><span class="road-tail">${project.availability === 'unreachable' ? 'Unreachable' : project.maps === 0 ? 'No maps yet' : `${project.maps} ${project.maps === 1 ? 'map' : 'maps'}`} ›</span></button>`).join('')}</section>`
    }).join('')}<button class="connection-add-row" data-open="connection"><span class="road-node open">＋</span><span><strong>Add GitHub connection</strong><span class="road-detail">Authorize selected repositories</span></span></button></div>
  </main>`)
}

function renderFlow() {
  const flow = state.flow
  if (flow.type === 'connection') return connectionFlow(flow)
  if (flow.type === 'project') return projectFlow(flow)
  if (flow.type === 'remove-project') return removeProjectFlow(flow)
  if (flow.type === 'remove-connection') return removeConnectionFlow(flow)
  if (flow.type === 'choose-project') return chooseProjectFlow()
  if (flow.type === 'choose-connection') return chooseConnectionFlow()
  return ''
}

function flowFrame(title, note, body, step = 1, total = 1) {
  return `<div class="scrim" role="presentation"><section class="flow" role="dialog" aria-modal="true" aria-labelledby="flow-title">
    <div class="flow-head"><div>${currentVariant === 'D' ? '' : '<p class="eyebrow">Prototype flow</p>'}<h2 id="flow-title">${title}</h2><p class="muted small">${note}</p></div><button class="icon-button" data-close aria-label="Close">×</button></div>
    <div class="flow-steps">${Array.from({ length: total }, (_, index) => `<span class="flow-step ${index < step ? 'done' : ''}"></span>`).join('')}</div>
    ${body}
  </section></div>`
}

function connectionFlow(flow) {
  if (flow.step === 1) return flowFrame('Add a connection', 'Choose the integration Roadmap should read.', `<div class="choice-grid"><button class="choice" data-connection-kind="github"><strong>GitHub.com</strong><p class="muted small">Authorize selected repositories with a GitHub App.</p><span class="pill github">Available</span></button><button class="choice" disabled><strong>Local</strong><p class="muted small">The built-in Local connection is already available.</p><span class="pill local">Built in</span></button></div>`, 1, 3)
  if (flow.step === 2) return flowFrame('Authorize GitHub', 'Open GitHub, enter this one-time code, then return here.', `<div class="device-code"><div><p class="muted small" style="text-align:center">github.com/login/device</p><strong>RM45-KP9Q</strong></div></div><div class="form-actions"><button class="button" data-copy-code>Copy code</button><button class="button primary" data-finish-connection>I've authorized Roadmap</button></div>`, 2, 3)
  return flowFrame('Name this connection', 'Use a name that distinguishes this account from your other GitHub connections.', `<div class="field"><label for="connection-name">Connection name</label><input id="connection-name" value="Authorized GitHub" placeholder="Personal GitHub"></div><div class="empty-note" style="margin-top:1rem">Signed in as <strong>@authorized-user</strong>. The token will be stored in Keychain, not roadmap.config.json.</div><div class="form-actions"><button class="button" data-close>Cancel</button><button class="button primary" data-save-connection>Save connection</button></div>`, 3, 3)
}

function projectFlow(flow) {
  const project = flow.projectId ? state.projects.find((candidate) => candidate.id === flow.projectId) : null
  const defaults = flow.form ?? {
    connectionId: flow.connectionId ?? project?.connectionId ?? 'github-personal',
    locator: project?.locator ?? '',
    name: project?.name ?? '',
    workspace: project?.workspace ?? '',
  }
  const errors = flow.errors ?? {}
  const verb = project ? 'Edit project registration' : 'Register a project'
  return flowFrame(verb, 'Roadmap validates the whole registration before saving any part of it.', `<form data-project-form data-project-id="${project?.id ?? ''}" novalidate>
    <div class="form-grid">
      <div class="field wide"><label for="connection">Connection</label><select id="connection" name="connectionId">${state.connections.map((connection) => `<option value="${connection.id}" ${connection.id === defaults.connectionId ? 'selected' : ''}>${connection.name} · ${statusLabel(connection.health)}</option>`).join('')}</select>${errors.connectionId ? `<span class="error">${errors.connectionId}</span>` : ''}</div>
      <div class="field wide"><label for="locator">${defaults.connectionId === 'local' ? 'Project directory' : 'Repository'}</label><input id="locator" name="locator" value="${escapeAttr(defaults.locator)}" placeholder="${defaults.connectionId === 'local' ? '~/source/project' : 'owner/repository'}">${errors.locator ? `<span class="error">${errors.locator}</span>` : '<span class="muted small">Try missing/repository to see access validation.</span>'}</div>
      <div class="field"><label for="name">Display name</label><input id="name" name="name" value="${escapeAttr(defaults.name)}" placeholder="Repository name"></div>
      <div class="field"><label for="workspace">Workspace</label><input id="workspace" name="workspace" value="${escapeAttr(defaults.workspace)}" placeholder="~/source/project" required>${errors.workspace ? `<span class="error">${errors.workspace}</span>` : ''}</div>
    </div>
    ${project ? projectAlerts(project, connectionFor(project)) : ''}
    <div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit">Validate and save</button></div>
    ${project ? `<div class="flow-danger-zone"><p class="eyebrow">Remove from Roadmap</p><p class="muted small">The repository is not changed.</p><button type="button" class="button danger" data-request-remove-project="${project.id}">Remove project registration</button></div>` : ''}
  </form>`, 1, 1)
}
function removeProjectFlow(flow) {
  const project = state.projects.find((candidate) => candidate.id === flow.projectId)
  return flowFrame(`Remove ${project.name}?`, 'This removes the Roadmap registration only.', `<p>The repository, its Wayfinder issues, and any local workspace stay unchanged.</p><div class="flow-danger-zone"><div class="form-actions"><button class="button" data-edit-project="${project.id}">Back to edit</button><button class="button danger" data-remove-project="${project.id}">Remove project</button></div></div>`)
}

function removeConnectionFlow(flow) {
  const connection = state.connections.find((candidate) => candidate.id === flow.connectionId)
  const dependents = dependentsOf(connection.id)
  if (dependents.length === 0) return flowFrame(`Remove ${connection.name}?`, 'This removes Roadmap configuration only.', `<p>The external GitHub account and repositories are unchanged.</p><div class="form-actions"><button class="button" data-close>Cancel</button><button class="button danger" data-confirm-remove-connection="${connection.id}">Remove connection</button></div>`)
  const alternatives = state.connections.filter((candidate) => candidate.id !== connection.id && candidate.health === 'healthy')
  return flowFrame(`Projects use ${connection.name}`, 'Choose where each registration goes, or explicitly remove the registrations.', `<div class="warning"><strong>${dependents.length} dependent ${dependents.length === 1 ? 'project' : 'projects'}</strong><p class="small" style="margin:.25rem 0 0">Roadmap will not silently remove or strand them.</p></div>
    <div style="margin:1rem 0">${dependents.map((project) => `<div class="dependent"><span><strong>${project.name}</strong><span class="muted small" style="display:block">${project.locator}</span></span><select data-reassign-project="${project.id}"><option value="">Choose action…</option>${alternatives.map((candidate) => `<option value="${candidate.id}">Move to ${candidate.name}</option>`).join('')}<option value="remove">Remove registration</option></select></div>`).join('')}</div>
    ${flow.error ? `<p class="warning small">${flow.error}</p>` : ''}
    <div class="form-actions"><button class="button" data-close>Cancel</button><button class="button danger" data-resolve-dependencies="${connection.id}">Apply choices and remove</button></div>`)
}

function chooseProjectFlow() {
  return flowFrame('Choose a project', 'Select a registration to edit or reassign.', `<div>${state.projects.map((project) => `<button class="ledger-row" data-edit-project="${project.id}"><span><strong>${project.name}</strong><span class="muted small">${project.locator}</span></span><span>${connectionFor(project).name}</span><span>${projectState(project)}</span><span>›</span></button>`).join('')}</div>`)
}

function chooseConnectionFlow() {
  return flowFrame('Choose a connection', 'Built-in Local cannot be removed.', `<div>${state.connections.map((connection) => `<div class="connection-row"><span class="connection-glyph ${connection.kind}">${connection.kind === 'github' ? 'G' : 'L'}</span><span><strong>${connection.name}</strong><span class="status ${connection.health}" style="display:flex">${statusLabel(connection.health)} · ${dependentsOf(connection.id).length} projects</span></span>${connection.builtIn ? '<span class="pill local">Built in</span>' : `<button class="button danger" data-remove-connection="${connection.id}">Remove</button>`}</div>`).join('')}</div>`)
}

function render() {
  const app = document.querySelector('#app')
  app.innerHTML = currentVariant === 'A' ? renderLedger() : currentVariant === 'B' ? renderGuide() : currentVariant === 'C' ? renderTerrain() : renderProduct()
}

function openFlow(type, extras = {}) {
  state.flow = { type, ...extras }
  state.notice = ''
  render()
}

function setVariant(next) {
  currentVariant = next
  const url = new URL(location.href)
  url.searchParams.set('variant', next)
  history.replaceState(null, '', url)
  state.flow = null
  render()
}
function setPage(next) {
  currentPage = next
  const url = new URL(location.href)
  url.searchParams.set('page', next)
  history.pushState(null, '', url)
  state.flow = null
  state.notice = ''
  render()
}

function cycleVariant(direction) {
  const index = variants.findIndex((variant) => variant.key === currentVariant)
  const next = variants[(index + direction + variants.length) % variants.length]
  setVariant(next.key)
}

function saveProject(form) {
  const data = Object.fromEntries(new FormData(form))
  const errors = {}
  const connection = state.connections.find((candidate) => candidate.id === data.connectionId)
  if (!connection || connection.health !== 'healthy') errors.connectionId = 'Authorize a healthy connection before using it.'
  if (!data.locator.trim()) errors.locator = 'Enter a repository or project directory.'
  if (data.locator.includes('missing')) errors.locator = 'Roadmap could not read this repository with the selected connection.'
  if (!data.workspace.trim()) errors.workspace = 'Choose a readable local workspace for this project.'
  if (data.workspace.includes('bad')) errors.workspace = 'This workspace directory does not exist or is not readable.'
  if (Object.keys(errors).length > 0) {
    state.flow = { type: 'project', projectId: form.dataset.projectId || null, form: data, errors }
    render()
    return
  }
  const existing = state.projects.find((project) => project.id === form.dataset.projectId)
  if (existing) {
    Object.assign(existing, { connectionId: data.connectionId, locator: data.locator, name: data.name || data.locator.split('/').at(-1), workspace: data.workspace })
    state.notice = `${existing.name} was validated, saved atomically, and queued for immediate reconciliation.`
  } else {
    const id = `${data.connectionId}-${Date.now()}`
    state.projects.push({ id, connectionId: data.connectionId, locator: data.locator, name: data.name || data.locator.split('/').at(-1), workspace: data.workspace, maps: 0, availability: 'reachable' })
    state.selectedProject = id
    state.notice = `${data.name || data.locator} was validated and registered. No Wayfinder map is required.`
  }
  state.flow = null
  render()
}

function removeProject(id) {
  const project = state.projects.find((candidate) => candidate.id === id)
  state.projects = state.projects.filter((candidate) => candidate.id !== id)
  state.selectedProject = state.projects[0]?.id
  state.notice = `${project.name} was removed from Roadmap. Its repository was not changed.`
  render()
}

function finishConnection() {
  if (state.flow.reauthorizeId) {
    const connection = state.connections.find((candidate) => candidate.id === state.flow.reauthorizeId)
    connection.health = 'healthy'
    state.notice = `${connection.name} was authorized again and queued for immediate reconciliation.`
    state.flow = null
  } else {
    state.flow = { ...state.flow, step: 3 }
  }
  render()
}

function saveConnection() {
  const name = document.querySelector('#connection-name').value.trim() || 'Authorized GitHub'
  const connection = { id: `github-${Date.now()}`, name, kind: 'github', health: 'healthy', account: '@authorized-user' }
  state.connections.push(connection)
  state.selectedConnection = connection.id
  state.notice = `${name} was added. Credentials are stored in Keychain.`
  state.flow = null
  render()
}

function removeConnection(id) {
  const connection = state.connections.find((candidate) => candidate.id === id)
  state.connections = state.connections.filter((candidate) => candidate.id !== id)
  state.notice = `${connection.name} was removed from Roadmap. External authorization is unchanged in this prototype.`
  state.flow = null
  render()
}

function resolveDependencies(id) {
  const selections = [...document.querySelectorAll('[data-reassign-project]')]
  if (selections.some((select) => !select.value)) {
    state.flow.error = 'Choose an action for every dependent project.'
    render()
    return
  }
  for (const select of selections) {
    if (select.value === 'remove') state.projects = state.projects.filter((project) => project.id !== select.dataset.reassignProject)
    else {
      const project = state.projects.find((candidate) => candidate.id === select.dataset.reassignProject)
      if (project) project.connectionId = select.value
    }
  }
  removeConnection(id)
}

document.addEventListener('click', (event) => {
  const clicked = event.target
  if (!(clicked instanceof Element)) return
  if (clicked.classList.contains('scrim')) { state.flow = null; render(); return }
  const target = clicked.closest('button, [data-action]')
  if (!target) return
  if (target.dataset.cycle) cycleVariant(Number(target.dataset.cycle))
  if (target.dataset.tab) { state.ledgerTab = target.dataset.tab; render() }
  if (target.dataset.hybridTab) { state.hybridTab = target.dataset.hybridTab; render() }
  if (target.dataset.page) setPage(target.dataset.page)
  if (target.dataset.goProject) { state.selectedProject = target.dataset.goProject; setPage('projects') }
  if (target.dataset.selectProject) { state.selectedProject = target.dataset.selectProject; state.notice = ''; render() }
  if (target.dataset.selectConnection) { state.selectedConnection = target.dataset.selectConnection; render() }
  if (target.dataset.open) openFlow(target.dataset.open, target.dataset.open === 'connection' ? { step: 1 } : {})
  if (target.dataset.openProjectFor) openFlow('project', { connectionId: target.dataset.openProjectFor })
  if (target.dataset.editProject) openFlow('project', { projectId: target.dataset.editProject })
  if (target.dataset.requestRemoveProject) openFlow('remove-project', { projectId: target.dataset.requestRemoveProject })
  if (target.dataset.removeProject) removeProject(target.dataset.removeProject)
  if (target.dataset.removeConnection) openFlow('remove-connection', { connectionId: target.dataset.removeConnection })
  if (target.dataset.reauthorize) openFlow('connection', { step: 2, reauthorizeId: target.dataset.reauthorize })
  if (target.dataset.connectionKind) { state.flow.step = 2; render() }
  if (target.dataset.finishConnection !== undefined) finishConnection()
  if (target.dataset.saveConnection !== undefined) saveConnection()
  if (target.dataset.addProjectNew !== undefined) openFlow('project', { connectionId: state.selectedConnection })
  if (target.dataset.confirmRemoveConnection) removeConnection(target.dataset.confirmRemoveConnection)
  if (target.dataset.resolveDependencies) resolveDependencies(target.dataset.resolveDependencies)
  if (target.dataset.close !== undefined) { state.flow = null; render() }
  if (target.dataset.copyCode !== undefined) { navigator.clipboard?.writeText('RM45-KP9Q'); state.notice = 'Device code copied.'; render() }
  if (target.dataset.projectLaunch) {
    const project = state.projects.find((candidate) => candidate.id === target.dataset.projectId)
    state.notice = target.dataset.projectLaunch === 'vscode' ? `Opening ${project.name}'s workspace in VS Code.` : `Opening ${project.name}'s local folder.`
    render()
  }
  if (target.dataset.openProjectView) {
    const project = state.projects.find((candidate) => candidate.id === target.dataset.openProjectView)
    state.notice = `Opening ${project.name}'s project page in Roadmap.`
    render()
  }
})

document.addEventListener('submit', (event) => {
  if (event.target.matches('[data-project-form]')) {
    event.preventDefault()
    saveProject(event.target)
  }
})

document.addEventListener('keydown', (event) => {
  const tag = event.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) return
  if (event.key === 'ArrowLeft') cycleVariant(-1)
  if (event.key === 'ArrowRight') cycleVariant(1)
  if (event.key === 'Escape' && state.flow) { state.flow = null; render() }
})

window.addEventListener('popstate', () => { currentVariant = variantFromUrl(); currentPage = pageFromUrl(); render() })

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
function escapeAttr(value) {
  return escapeHtml(String(value)).replaceAll('"', '&quot;')
}

render()
