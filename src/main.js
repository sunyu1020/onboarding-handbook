import './style.css'
// 开挂室 React Hero（首屏）：挂载 PrismaHero 到 #prisma-hero-root
import './hero-react.tsx'
import systemPrompt from './prompt.txt?raw'
import todoParsePromptRaw from './prompt-todo-parse.txt?raw'
import projectParsePromptRaw from './prompt-project-parse.txt?raw'
import smartParsePromptRaw from './prompt-smart-parse.txt?raw'
import meetingPrompt from './prompt-meeting.txt?raw'
import weeklyPrompt from './prompt-weekly.txt?raw'
import upwardPrompt from './prompt-upward.txt?raw'
import jobsData from '../data/jobs.json'
import booksData from '../data/books.json'
import dilemmasData from '../data/dilemmas.json'
import jdOcrPrompt from './prompt-jd-ocr.txt?raw'
import jdAgentPrompt from './prompt-jd-agent.txt?raw'
import jdChatPrompt from './prompt-jd-chat.txt?raw'

// ===== 常量 =====
// systemPrompt 逐字复制自 prompt-岗位拆解.md「System Prompt」代码块（v2.1 定稿，一字不改）
const API_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || ''
const LS_KEY = 'job_library' // AI 生成收藏（存完整数据）
const PRESET_FAV_KEY = 'preset_favorites' // 预置岗位收藏（只存 id，数据仍读 jobs.json）
const THEME_KEY = 'theme_preview'
const COLLAPSED_COUNT = 9 // 岗位库收起时展示 9 个 + 「查看更多」格

// ============================================================
// 演示模式 + AI 记忆层（无需配置 Key 也能完整体验；同时聚合用户上下文）
// ============================================================
const DEMO_MODE = !API_KEY
const PROFILE_KEY = 'odb_profile'

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}
  } catch {
    return {}
  }
}
function saveProfile(p) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}
function updateProfile(patch) {
  const p = loadProfile()
  const next = { ...p, ...patch, updatedAt: Date.now() }
  saveProfile(next)
  return next
}

// 演示模式状态提示（岗位拆解结果区用）
function renderDemoStatus(msg) {
  statusEl.innerHTML = ''
  const card = el('div', 'demo-status')
  card.append(el('span', 'demo-status-icon', '🧪'), el('p', 'demo-status-text', msg))
  statusEl.append(card)
}

// 从 jobs.json 里按输入匹配内置岗位
function findPresetJob(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return null
  const list = jobsData.jobs
  let hit = list.find((j) => (j.name || '').toLowerCase() === q)
  if (!hit) hit = list.find((j) => (j.name || '').toLowerCase().includes(q) || q.includes((j.name || '').toLowerCase()))
  if (!hit) hit = list.find((j) => (j.category || '').toLowerCase().includes(q))
  if (!hit) hit = list.find((j) => (j.dailyWork || []).some((t) => t.toLowerCase().includes(q)))
  return hit || null
}

// 从困境库（含自定义）里按关键词匹配
function findDilemma(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return null
  const all = getAllDilemmas()
  let hit = all.find((d) => (d.title || '').toLowerCase().includes(q))
  if (!hit) hit = all.find((d) => (d.tags || []).some((t) => (t || '').toLowerCase().includes(q)))
  if (!hit) hit = all.find((d) => (d.solutions || []).some((s) => ((s.say || '') + (s.do || '')).toLowerCase().includes(q)))
  return hit || null
}

// 从文本里猜到期日
function guessDueDate(line) {
  let m = line.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  m = line.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (m) return `${new Date().getFullYear()}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  if (/今天|今日|today/i.test(line)) return todayStr()
  if (/明天|明日|tomorrow/i.test(line)) return addDaysStr(1)
  if (/后天/i.test(line)) return addDaysStr(2)
  if (/下周|周[一二三四五六日天]/.test(line)) return addDaysStr(7)
  return null
}
function addDaysStr(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function itemTitle(x) {
  return (x && (x.title || x.task || x.name)) || '事项'
}

// 生成给真实 AI 的用户记忆上下文（仅在配置了 Key 时注入 prompt）
function profileContextText() {
  const p = loadProfile()
  const parts = []
  if (p.landingJob) parts.push(`用户正在登陆的岗位：${p.landingJob}`)
  if (p.lastRole) parts.push(`最近关注的岗位方向：${p.lastRole}`)
  const s = buildCommonStats()
  if (s.riskTotal > 0) parts.push(`当前有 ${s.riskTotal} 个延期/临期风险（${s.riskSub}）`)
  if (p.dilemmasTackled && p.dilemmasTackled.length) parts.push(`用户已 tackling 过的困境主题：${p.dilemmasTackled.slice(0, 3).join('、')}`)
  if (p.reportCount) parts.push(`用户已生成过 ${p.reportCount} 次周报`)
  return parts.length ? '【用户记忆上下文】\n' + parts.join('\n') + '\n\n请结合以上背景作答，并在合适处呼应这些背景。' : ''
}

// 记忆线索（可见版）：把「用户登陆岗位 / 破解过的困境」转成一句前缀，注入各屏产出，
// 让"AI 记得你"从进度条里一行小字，变成用户能直接看到的、被个性化改写的产出。
function memoryLeadIn() {
  const p = loadProfile()
  const bits = []
  if (p.landingJob) bits.push(`你正在登陆的【${p.landingJob}】岗`)
  if (p.dilemmasTackled && p.dilemmasTackled.length)
    bits.push(`你曾破解「${p.dilemmasTackled[p.dilemmasTackled.length - 1]}」`)
  return bits.length ? `🧠 已结合${bits.join('、')}的背景为你整理` : ''
}

// ===== P1-3：AI 产出来源 / 时间标注 + 演示可信横幅 =====
function aiProvStamp(when) {
  const d = when ? new Date(when) : new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function aiProvHTML(kind, when) {
  const t = aiProvStamp(when)
  if (kind === 'demo') {
    return `<div class="ai-prov demo"><span class="ai-prov-ico">🧪</span><div class="ai-prov-body"><div class="ai-prov-title">演示模式 · AI 示例内容</div><div class="ai-prov-desc">以下由 AI 基于内置示例数据生成，并非你的真实工作数据。配置 API Key 后将基于你的真实输入实时生成。</div><div class="ai-prov-time">生成于 ${t}</div></div></div>`
  }
  if (kind === 'real-ai') {
    return `<div class="ai-prov tag"><span>🤖 AI 生成</span><span class="ai-prov-dot">·</span><span>${t}</span></div>`
  }
  return `<div class="ai-prov tag curated"><span>📚 精选内容</span><span class="ai-prov-dot">·</span><span>登陆岛</span></div>`
}
function prependHTML(wrap, html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html.trim()
  while (tmp.firstChild) wrap.insertBefore(tmp.firstChild, wrap.firstChild)
}

// ===== 7 个 AI 入口的离线兜底 =====
function demoJobBreakdown(name) {
  const hit = findPresetJob(name)
  statusEl.innerHTML = ''
  if (hit) {
    updateProfile({ landingJob: hit.name, lastRole: hit.category })
    renderResult(hit, { favoritable: true, preset: true })
    logActivity('demo-job', '演示模式拆解：' + hit.name)
  } else {
    const sample = jobsData.jobs.find((j) => j.id === 'product-manager') || jobsData.jobs[0]
    updateProfile({ landingJob: sample.name, lastRole: sample.category })
    renderResult(sample, { favoritable: true, preset: true })
    logActivity('demo-job', '演示模式示例拆解：' + sample.name)
  }
  renderOnboardingProgress()
}

function demoSmartParse(text) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const todos = []
  const projects = []
  // 项目关键词：出现这些词且带日期/负责人的行，更可能是一个项目节点
  const projectKw = /项目|拍摄|脚本|发布会|宣传片|改版|剪辑|物料|上线|交付|初稿|大纲|短视频|直播|活动|campaign/i
  for (const line of lines) {
    const due = guessDueDate(line)
    const ownerMatch = line.match(/([\u4e00-\u9fa5]{2,4})(?=负责|Owner|owner|牵头|主责|执行)/)
    const owner = ownerMatch ? ownerMatch[1] : '我'
    const isExplicitProject = /^项目[:：]|项目[-—]|【项目】|项目名称/.test(line)
    const looksLikeProject = projectKw.test(line) && (due || /负责|owner|风险|延期|截止|交付/.test(line))
    if (isExplicitProject || looksLikeProject) {
      const title = line
        .replace(/^项目[:：\-—]|【项目】|项目名称[:：]?/, '')
        .replace(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}|\d{1,2}月\d{1,2}[日号]?|今天|今日|明天|明日|下周|周[一二三四五六日天]/g, '')
        .replace(/负责[:：]?|owner[:：]?/i, '')
        .replace(/[，,。.；;]+$/g, '')
        .trim()
      const risks = []
      if (/风险|延期|人手不够|缺人|未定|没定|可能/.test(line)) risks.push('存在潜在延期/资源风险')
      projects.push({ name: title || line, deadline: due, owner, risks })
      continue
    }
    const prio = /紧急|立刻|马上|尽快|高优|重要|必须/.test(line) ? '高' : /不急|有空|低优|次要|暂缓/.test(line) ? '低' : '中'
    const title = line
      .replace(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}|\d{1,2}月\d{1,2}[日号]?|今天|今日|明天|明日|下周|周[一二三四五六日天]/g, '')
      .replace(/[，,。.；;]+$/g, '')
      .trim() || line
    todos.push({ title, dueDate: due, priority: prio, note: null })
  }
  if (!todos.length && !projects.length) {
    todos.push({ title: '梳理本周产品需求池，输出优先级清单', dueDate: addDaysStr(2), priority: '高', note: '来自演示数据' })
    todos.push({ title: '跟进上线后核心指标波动，写一页复盘', dueDate: addDaysStr(4), priority: '中', note: null })
    todos.push({ title: '约 mentor 做一次 1:1 对齐', dueDate: addDaysStr(1), priority: '中', note: null })
  }
  renderSmartConfirm({ todos, projects })
  logActivity('demo-parse', '演示模式解析排期')
  renderOnboardingProgress()
}

function demoExtractMeeting(text) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const title = (lines[0] || '本周同步会').slice(0, 40)
  const conclusions = []
  const actionItems = []
  const openQuestions = []
  for (const line of lines.slice(1)) {
    if (/决定|结论|确认|达成一致|敲定|对齐/.test(line)) conclusions.push(line)
    else if (/待办|行动|去做|负责|跟进|排期|下周|落实/.test(line))
      actionItems.push({ task: line, owner: '〔负责人待确认〕', deadline: guessDueDate(line) || '〔时间待确认〕', priority: 'low' })
    else if (/\?|？|疑问|待定|不确定|不清楚/.test(line)) openQuestions.push(line)
    else if (line) conclusions.push(line)
  }
  if (!conclusions.length && !actionItems.length && !openQuestions.length) {
    conclusions.push('本期核心目标是对齐本周交付优先级，确保关键路径不阻塞')
    actionItems.push({ task: '整理需求池并按优先级排期', owner: '我', deadline: addDaysStr(3), priority: 'medium' })
    actionItems.push({ task: '跟进上线数据，输出一页复盘', owner: '我', deadline: addDaysStr(5), priority: 'medium' })
    openQuestions.push('下季度资源是否追加尚未确认')
  }
  const meeting = {
    id: 'm' + Date.now(),
    title,
    date: todayStr(),
    conclusions,
    actionItems,
    openQuestions,
    createdAt: Date.now(),
  }
  const meetLead = memoryLeadIn()
  if (meetLead) meeting.memoryNote = meetLead
  const meetings = loadMeetings()
  meetings.unshift(meeting)
  saveMeetings(meetings)
  renderMeetStatus('none')
  renderMeetingResult(meeting)
  logActivity('demo-meeting', '演示模式提炼纪要')
  renderOnboardingProgress()
}

function buildWeeklyText(snap) {
  const job = loadProfile().landingJob
  const L = []
  L.push(`本周工作汇报（${snap.weekStart} ~ ${snap.today}）`)
  L.push('')
  if (job) L.push(`📌 基于你正在登陆的【${job}】岗，本周工作如下：`)
  L.push(`一、整体进展：本周完成 ${snap.completed.length} 项，进行中 ${snap.projects.length} 个项目，整体完成度 ${snap.completion}%。`)
  L.push('')
  if (snap.completed.length) {
    L.push('二、本周完成')
    for (const c of snap.completed) L.push(`• ${itemTitle(c)}`)
    L.push('')
  }
  if (snap.projects.length) {
    L.push('三、进行中项目')
    for (const p of snap.projects) L.push(`• ${itemTitle(p)}（${p.stage || '进行中'}）`)
    L.push('')
  }
  if (snap.overdue.length) {
    L.push('四、需要关注（逾期/临期）')
    for (const o of snap.overdue) L.push(`• ${itemTitle(o)} — 请协助排期`)
    L.push('')
  }
  if (snap.risks.length) {
    L.push('五、风险与待协调')
    for (const r of snap.risks) L.push(`• ${itemTitle(r)}`)
    L.push('')
  }
  if (snap.nextWeek.length) {
    L.push('六、下周计划')
    for (const n of snap.nextWeek) L.push(`• ${itemTitle(n)}`)
    L.push('')
  }
  L.push(`（本汇报由登陆岛基于你的真实数据生成${job ? `，并已结合你登陆的【${job}】岗背景` : ''}，可直接编辑后复制）`)
  return L.join('\n')
}

function demoGenerateWeekly() {
  const snap = buildWeeklySnapshot()
  const content = buildWeeklyText(snap)
  repEditorEl.value = content
  const reports = loadReports()
  const existing = reports.find((r) => r.weekStart === snap.weekStart)
  if (existing) {
    existing.weekly = content
    existing.createdAt = Date.now()
  } else {
    reports.unshift({ id: 'r' + Date.now(), weekStart: snap.weekStart, weekly: content, upward: null, createdAt: Date.now() })
  }
  saveReports(reports)
  repCopyBtn.hidden = false
  repCopyWechatBtn.hidden = false
  repCopyEmailBtn.hidden = false
  updateRepEditorClose()
  renderRepHistory()
  refreshRepStats()
  updateRepGenerateBtn()
  const repProvEl = document.getElementById('rep-prov')
  if (repProvEl) repProvEl.innerHTML = aiProvHTML('demo')
  updateProfile({ reportCount: (loadProfile().reportCount || 0) + 1 })
  logActivity('demo-weekly', '演示模式生成周报')
  renderOnboardingProgress()
}

function buildUpwardText(snap) {
  const job = loadProfile().landingJob
  const L = []
  L.push('【向上汇报 · 给领导的版本】')
  L.push('')
  if (job) L.push(`📌 结合你正在登陆的【${job}】岗与本周真实数据，向领导同步如下：`)
  L.push('领导好，本周同步三件事：')
  L.push('')
  L.push(`1）进度：本周完成 ${snap.completed.length} 项，核心项目按计划推进，整体完成度 ${snap.completion}%。`)
  if (snap.risks.length || snap.overdue.length) {
    const topRisk = (snap.risks[0] && itemTitle(snap.risks[0])) || (snap.overdue[0] && itemTitle(snap.overdue[0])) || '部分排期'
    L.push(`2）需要支持：当前有 ${snap.risks.length + snap.overdue.length} 项存在延期/临期风险，主要是「${topRisk}」${job ? `，在【${job}】岗的职责范围内` : ''}，希望领导帮忙协调资源与优先级。`)
  } else {
    L.push('2）风险：本周暂无重大阻塞，如有变化第一时间同步。')
  }
  L.push('3）下周重点：' + (snap.nextWeek.length ? snap.nextWeek.map((n) => itemTitle(n)).join('、') : '持续推进在手项目'))
  L.push('')
  L.push('—— 以上基于周报原文提炼，细节见周报。')
  return L.join('\n')
}

function demoGenerateUpward(weeklyText) {
  const snap = buildWeeklySnapshot()
  const content = buildUpwardText(snap)
  repUpwardEditorEl.value = content
  repUpwardCopyBtn.hidden = false
  repUpwardWechatBtn.hidden = false
  repUpwardEmailBtn.hidden = false
  const reports = loadReports()
  const r = reports.find((x) => x.weekStart === snap.weekStart)
  if (r) {
    r.upward = content
    saveReports(reports)
    renderRepHistory()
  }
  renderRepUpwardStatus('success', '向上汇报已生成（演示模式：主动暴露风险、向领导要支持）')
  const upProvEl = document.getElementById('rep-upward-prov')
  if (upProvEl) upProvEl.innerHTML = aiProvHTML('demo')
  logActivity('demo-upward', '演示模式生成向上汇报')
}

function demoCustomDilemma(ask) {
  const q = (ask || dilemmaLastAsk || '').trim()
  if (!q) return
  dilemmaLastAsk = q
  const hit = findDilemma(q)
  const base = hit || dilemmasData.dilemmas.find((d) => d.id === 'buwen') || dilemmasData.dilemmas[0]
  const resolved = hit ? base : { ...base, id: 'c' + Date.now(), title: q.slice(0, 20) || '我的困境', ai: true }
  if (!hit) {
    const list = loadCustomDilemmas()
    list.unshift(resolved)
    saveCustomDilemmas(list)
  }
  selectedDilemmaId = resolved.id
  renderDilemmaTags()
  renderDilemmaDetail(resolved)
  openDilemmaInputEl.value = ''
  openDilemmaMatchEl.innerHTML = ''
  const p = loadProfile()
  const tackled = Array.from(new Set([...(p.dilemmasTackled || []), resolved.title])).slice(-10)
  updateProfile({ dilemmasTackled: tackled })
  logActivity('demo-dilemma', '演示模式拆解困境：' + q)
  renderOnboardingProgress()
}

function demoParseJd(text) {
  const hit = findPresetJob(text) || jobsData.jobs.find((j) => j.id === 'product-manager') || jobsData.jobs[0]
  updateProfile({ landingJob: hit.name, lastRole: hit.category })
  const job = {
    ...hit,
    jobName: hit.name,
    oneLineTruth: hit.oneLineTruth || `${hit.name}：真实的一天，远不止岗位名写的那些`,
  }
  jdLastJobName = hit.name
  renderJdResult(job)
  jdChatMessages = []
  jdChatSystem = jdChatPrompt.replace('{上一步生成的 JSON}', JSON.stringify(job))
  jdChatBoxEl.innerHTML = ''
  jdChatEl.hidden = false
  renderJdStatus('none')
  logActivity('demo-jd', '演示模式拆解 JD：' + hit.name)
  renderOnboardingProgress()
}

// ===== 登陆进度主线（由真实数据驱动）+ AI 记忆展示（融合进新手引导浮层）=====
function buildProgressHtml() {
  const landing = loadLibrary().length > 0 || !!loadProfile().landingJob
  const ledger = loadTodos().length + loadProjects().length > 0
  const minutes = loadMeetings().length > 0
  const report = !!loadReports().find((r) => r.weekly)
  const steps = [
    { label: '拆解岗位', done: !!landing },
    { label: '建工作台台账', done: ledger },
    { label: '出会议纪要', done: minutes },
    { label: '交周报', done: report },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)
  const p = loadProfile()
  const memoryBits = []
  if (p.landingJob) memoryBits.push(`正在登陆【${p.landingJob}】`)
  const s = buildCommonStats()
  if (s.riskTotal > 0) memoryBits.push(`${s.riskTotal} 个延期/临期风险`)
  if (p.dilemmasTackled && p.dilemmasTackled.length) memoryBits.push(`破解过 ${p.dilemmasTackled.length} 个困境`)
  if (p.reportCount) memoryBits.push(`生成过 ${p.reportCount} 次周报`)
  return `
    <div class="onb-head">
      <span class="onb-title">登陆进度</span>
      <span class="onb-pct">${pct}%</span>
    </div>
    <div class="onb-track"><div class="onb-fill" style="width:${pct}%"></div></div>
    <div class="onb-steps">
      ${steps.map((st) => `<span class="onb-step ${st.done ? 'done' : ''}">${st.done ? '✓' : '○'} ${st.label}</span>`).join('')}
    </div>
    ${
      memoryBits.length
        ? `<div class="onb-memory">🧠 AI 记得你：${memoryBits.join(' · ')}</div>`
        : `<div class="onb-memory onb-memory-empty">🧠 AI 记忆已就绪：你的每一步都会被记住，跨屏协同</div>`
    }
    ${DEMO_MODE ? `<div class="onb-demo">🧪 演示模式：无需配置 Key，所有 AI 功能均可直接体验 <button type="button" id="onb-demo-clear" class="onb-demo-clear">清空示例数据</button></div>` : ''}
  `
}

// 仅在新手引导浮层内渲染（原独立进度条已移入新手引导，不再置于首屏上方）
function renderOnboardingProgress() {
  const host = document.getElementById('onb-progress-host')
  if (!host) return
  host.innerHTML = buildProgressHtml()
  if (typeof renderEntryProgress === 'function') renderEntryProgress()
}

// 8 个结果模块，渲染顺序严格按任务表（oneLineTruth 单独大字渲染，不在此列）
const MODULES = [
  { key: 'dailyWork', title: '日常在干什么', type: 'list' },
  { key: 'kpi', title: '考核怎么算', type: 'list' },
  { key: 'keyCompetencies', title: '关键能力', type: 'tags' },
  { key: 'firstMonthPitfalls', title: '第一个月的坑', type: 'list' },
  { key: 'collaboration', title: '打交道地图', type: 'collab' },
  { key: 'week1Checklist', title: '第一周清单', type: 'checklist' },
]

// 隐私脱敏：去掉 verifiedBy 括号里出现的具体公司名
// 触发脱敏的条件（满足任一即剥掉括号内容）：
//   1) 含顿号/逗号 → 多公司并列
//   2) 含职位关键词（实习/助理/工程师/产品/经理/运营/组/部/分析/财务/会计/营销/推广/投放/开发/发展/专员/顾问/管理师/负责人/负责人/设计师）
//   3) 含 4 位年份（20\d{2}）→ "字节跳动 2025.11-2026.02" 这类
// 否则保留（"待人工校验"等说明性括号）
function sanitizeVerified(text) {
  if (!text) return ''
  return text.replace(/（([^）]*)）/g, (m, inner) => {
    if (
      inner.includes('、') ||
      inner.includes(',') ||
      inner.includes(',') ||
      /20\d{2}/.test(inner) ||
      /(实习|助理|工程师|经理|运营|组|部|分析|财务|会计|营销|推广|投放|开发|发展|专员|顾问|管理师|设计师|策划|负责人|顾问)/.test(inner)
    ) {
      return ''
    }
    return m
  })
}

// HTTP 状态码 → 人话
const ERROR_MSGS = {
  401: 'API Key 无效：请检查 .env 里的 VITE_DEEPSEEK_API_KEY 是否填写正确，改完刷新页面再试',
  402: 'DeepSeek 账户额度不足：到 platform.deepseek.com 充值后再试',
  429: '请求太频繁：稍等十几秒再试一次',
}

// ===== DOM =====
const $ = (id) => document.getElementById(id)
const inputEl = $('jd-composer-input') // 合并后的单一输入框（岗位名 / JD / 截图共用）
const generateBtn = $('jd-composer-btn') // 一键拆解（由 routeBreakdown 自动路由）
const statusEl = $('status-area')
const resultEl = $('result-area')
const presetGridEl = $('preset-grid')
const favGridEl = $('fav-grid')
const favEmptyEl = $('fav-empty')
const viewAllBtn = $('view-all-btn')

let lastInput = '' // 当前这次输入，供重试按钮复用
let generating = false
let presetExpanded = false // grid 平铺态；fan 轮播是默认
let activeFanIdx = 0 // fan 轮播当前居中的卡片索引（悬停或默认 = 0）

// ===== 工具 =====
function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

// 把「角色：说明」切成两段，无分隔符时整段放后半
function splitPair(str) {
  const i = str.search(/[:：]/)
  return i > 0 ? [str.slice(0, i), str.slice(i + 1)] : ['', str]
}

// 统一空态组件（样式阶段一处美化全局生效）
function emptyStateHTML(icon, title, hint = '') {
  return `<div class="empty-state">
    <span class="empty-state-icon" aria-hidden="true">${icon}</span>
    <p class="empty-state-title">${title}</p>
    ${hint ? `<p class="empty-state-hint">${hint}</p>` : ''}
  </div>`
}

// ===== 配色切换（临时，选定后删除） =====
function initThemeSwitcher() {
  // 定稿配色为奶油毛玻璃，不再使用霓虹主题切换
  // document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'blue'
  // 配色预览临时控件：正常访问隐藏，URL 带 ?theme=1 时唤出（定稿配色后整体删除）
  // 顶部导航已被 FloatingNav 替代，这里做空值守卫防止 URL 触发时炸掉
  if (location.search.includes('theme=1')) {
    const preview = document.getElementById('theme-preview')
    if (preview) preview.removeAttribute('hidden')
  }
  document.querySelectorAll('.theme-preview .theme-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.documentElement.dataset.theme = btn.dataset.theme
      localStorage.setItem(THEME_KEY, btn.dataset.theme)
    })
  })
}

// ===== AI 生成链路 =====
async function generate() {
  const name = inputEl.value.trim()
  if (!name) {
    inputEl.focus()
    return
  }
  if (generating) return
  lastInput = name

  if (DEMO_MODE) {
    demoJobBreakdown(name)
    return
  }

  generating = true
  generateBtn.disabled = true
  generateBtn.textContent = '拆解中…'
  renderLoading()
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${profileContextText()}\n岗位：${name}。宁可写满也不要提前收工` },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空，请重试')
    const job = parseJsonSafe(content)
    statusEl.innerHTML = ''
    renderResult(job, { favoritable: true })
  } catch (err) {
    renderError(err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    generating = false
    generateBtn.disabled = false
    generateBtn.textContent = '一键拆解'
  }
}

// JSON 解析：先直接 parse；失败则截取第一个 { 到最后一个 } 重试一次
function parseJsonSafe(text) {
  try {
    return JSON.parse(text)
  } catch {}
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(text.slice(s, e + 1))
    } catch {}
  }
  throw new Error('AI 返回的内容不是有效 JSON，请重试')
}

// ===== 状态卡片：无 key / 加载中 / 报错 =====
function renderKeyGuide() {
  statusEl.innerHTML = ''
  resultEl.innerHTML = ''
  const card = el('div', 'status-card status-key')
  card.append(
    el('div', 'status-icon', '🔑'),
    el('h3', 'status-title', '还没配置 DeepSeek API Key'),
    el('p', 'status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
  )
  statusEl.append(card)
}

function renderLoading() {
  statusEl.innerHTML = ''
  resultEl.innerHTML = ''
  const card = el('div', 'status-card status-loading')
  card.append(el('div', 'spinner'), el('p', 'status-text', '正在拆解，约需 10~20 秒…'))
  statusEl.append(card)
  const sk = el('div', 'skeleton-grid')
  for (let i = 0; i < 3; i++) sk.append(el('div', 'skeleton-card'))
  resultEl.append(sk)
}

function renderError(msg) {
  statusEl.innerHTML = ''
  resultEl.innerHTML = ''
  const card = el('div', 'status-card status-error')
  card.append(
    el('div', 'status-icon', '⚠️'),
    el('h3', 'status-title', '生成失败'),
    el('p', 'status-text', msg),
  )
  const retry = el('button', 'btn-secondary', '重试')
  retry.type = 'button'
  retry.addEventListener('click', generate)
  card.append(retry)
  statusEl.append(card)
}

// 岗位拆解模块内容（preset 点击 / JD 拆解结果共用）
function populateModuleBody(body, m, items) {
  const inner = el('div', 'module-body-inner')

  if (m.type === 'tags') {
    const tagGrid = el('div', 'tag-grid tag-grid--compact')
    for (const it of items) {
      const [name] = splitPair(it)
      tagGrid.append(el('span', 'tag-pill', name || it))
    }
    inner.append(tagGrid)
    body.append(inner)
    return
  }

  if (m.type === 'checklist') {
    const ul = el('ul', 'module-list')
    for (const it of items) {
      const li = el('li')
      const label = el('label', 'check-item')
      const cb = el('input')
      cb.type = 'checkbox'
      label.append(cb, el('span', 'check-text', it))
      li.append(label)
      ul.append(li)
    }
    inner.append(ul)
    body.append(inner)
    return
  }

  const ul = el('ul', 'module-list')
  for (const it of items) {
    const li = el('li')
    if (m.type === 'collab') {
      const [role, desc] = splitPair(it)
      if (role) li.append(el('strong', 'collab-role', role + '：'))
      li.append(el('span', '', desc || it))
    } else {
      const [label, rest] = splitPair(it)
      if (label) {
        li.append(el('strong', 'module-item-label', label + '：'), el('span', '', rest || it))
      } else {
        li.append(el('span', '', it))
      }
    }
    ul.append(li)
  }
  inner.append(ul)
  body.append(inner)
}

// ===== 结果渲染（8 模块） =====
function renderResult(job, { favoritable = false, preset = false } = {}, target = resultEl) {
  target.innerHTML = ''
  const wrap = el('div', 'result-wrap')

  // 头部：返回按钮 + 岗位名 + meta + 收藏按钮
  const head = el('div', 'result-head')
  // 返回岗位库（左侧，岗位名旁边）
  const backBtn = el('button', 'result-back-btn')
  backBtn.type = 'button'
  backBtn.setAttribute('aria-label', '返回岗位库')
  backBtn.innerHTML =
    '<svg class="result-back-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
    '<path d="M10.5 3 L4.5 8 L10.5 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg><span>返回岗位库</span>'
  backBtn.addEventListener('click', () => {
    const lib = document.querySelector('.library')
    // 先清空结果再滚动，避免结果区高度变化导致跳转偏移
    target.innerHTML = ''
    statusEl.innerHTML = ''
    if (lib) {
      requestAnimationFrame(() => {
        const rect = lib.getBoundingClientRect()
        window.scrollTo({ top: rect.top + window.scrollY - 70, behavior: 'smooth' })
      })
    }
  })
  head.append(backBtn)

  const titleBox = el('div', 'title-box')
  titleBox.append(el('h2', 'result-job-name', preset ? job.name : (job.jobName || job.name)))
  const meta = el('div', 'result-meta')
  if (preset) {
    if (job.category) meta.append(el('span', 'chip', job.category))
    const verifiedDisplay = sanitizeVerified(job.verifiedBy)
    if (verifiedDisplay) meta.append(el('span', 'chip chip-ghost', verifiedDisplay))
  } else {
    const verifiedDisplay = sanitizeVerified(job.verifiedBy || 'AI 生成')
    meta.append(el('span', 'chip', verifiedDisplay))
  }
  titleBox.append(meta)
  head.append(titleBox)
  if (favoritable) {
    const favBtn = el('button', 'btn-fav', '收藏')
    favBtn.type = 'button'
    favBtn.addEventListener('click', () => saveToLibrary(job, lastInput, favBtn))
    head.append(favBtn)
  }
  wrap.append(head)

  // 1. oneLineTruth 大字突出
  if (job.oneLineTruth) {
    const truth = el('div', 'one-line-truth')
    truth.append(el('div', 'truth-label', '一句话本质'), el('p', 'truth-text', job.oneLineTruth))
    wrap.append(truth)
  }

  // 2-7 模块卡片：固定 6 格 bento 布局，数据缺失时显示占位（保证格数恒定）
  const grid = el('div', 'modules-grid')
  for (const m of MODULES) {
    const items = Array.isArray(job[m.key]) ? job[m.key] : []
    const card = el('section', 'module-card module-card--' + m.key)
    if (!items.length) card.classList.add('is-empty')
    const headBtn = el('button', 'module-head')
    headBtn.type = 'button'
    const titleSpan = el('span', 'module-title', m.title)
    if (m.type === 'checklist') {
      const checkIcon = document.createElement('span')
      checkIcon.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      titleSpan.append(checkIcon)
    }
    headBtn.append(titleSpan, el('span', 'module-count', items.length ? String(items.length) : '—'))
    headBtn.addEventListener('click', () => card.classList.toggle('collapsed'))
    const collapse = el('div', 'module-collapse')
    const body = el('div', 'module-body')
    if (!items.length) {
      // 空数据兜底：保持 6 格结构完整
      const inner = el('div', 'module-body-inner')
      inner.append(el('p', 'module-empty', '这部分内容还在整理中'))
      body.append(inner)
      collapse.append(body)
      card.append(headBtn, collapse)
      grid.append(card)
      continue
    }
    populateModuleBody(body, m, items)
    collapse.append(body)
    card.append(headBtn, collapse)
    grid.append(card)
  }
  wrap.append(grid)
  target.append(wrap)
  requestAnimationFrame(() => syncBottomRowHeight())
}

// 让底行左右两格高度跟随打交道地图，溢出内部滚动
let bottomRowObserver = null

function syncBottomRowHeight() {
  if (bottomRowObserver) {
    bottomRowObserver.disconnect()
    bottomRowObserver = null
  }
  const grid = document.querySelector('.modules-grid')
  if (!grid) return
  const collab = grid.querySelector('.module-card--collaboration')
  const pitfalls = grid.querySelector('.module-card--firstMonthPitfalls')
  const week1 = grid.querySelector('.module-card--week1Checklist')
  if (!collab || !pitfalls || !week1) return

  const setHeight = () => {
    const h = collab.getBoundingClientRect().height
    pitfalls.style.maxHeight = `${h}px`
    week1.style.maxHeight = `${h}px`
  }

  bottomRowObserver = new ResizeObserver(setHeight)
  bottomRowObserver.observe(collab)
  setHeight()
}

// ===== 岗位库：正方形网格 =====
function getPresetFavorites() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_FAV_KEY)) || []
  } catch {
    return []
  }
}

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || []
  } catch {
    return []
  }
}

function saveToLibrary(job, userInput, favBtn) {
  const lib = loadLibrary()
  lib.unshift({
    id: String(Date.now()),
    name: userInput,
    category: 'AI 生成',
    verifiedBy: 'AI 生成（你自己拆解）',
    ...job,
  })
  localStorage.setItem(LS_KEY, JSON.stringify(lib))
  renderFavGrid()
  logActivity('job-save', '收藏岗位：' + userInput)
  updateProfile({ landingJob: userInput, lastRole: job.category || job.lastRole || '' })
  renderOnboardingProgress()
  if (favBtn) {
    favBtn.textContent = '已收藏 ✓'
    favBtn.disabled = true
  }
}

// 一个岗位正方形：名称 + 右上角 ☆（P1：selectable=true 时点击改为选入对比）
function jobSquare(job, { preset, selectable = false }) {
  const starred = preset ? getPresetFavorites().includes(job.id) : true
  const sq = el('div', 'job-square')
  if (selectable && comparePicks.some((p) => p.key === favKey(job, preset))) sq.classList.add('compare-pick')
  const nameBtn = el('button', 'job-square-name', job.name)
  nameBtn.type = 'button'
  if (selectable) {
    nameBtn.title = '点选进入对比（最多选 2 个）'
    nameBtn.addEventListener('click', () => toggleComparePick(job, preset))
  } else {
    nameBtn.addEventListener('click', () => {
      renderResult(job, { preset })
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const star = el('button', 'job-star', starred ? '★' : '☆')
  star.type = 'button'
  star.classList.toggle('starred', starred)
  star.title = starred ? '取消收藏' : '收藏'
  star.addEventListener('click', () => toggleFavorite(job, preset))
  sq.append(nameBtn, star)
  return sq
}

function toggleFavorite(job, preset) {
  if (preset) {
    const ids = getPresetFavorites()
    const i = ids.indexOf(job.id)
    if (i >= 0) ids.splice(i, 1)
    else ids.unshift(job.id)
    localStorage.setItem(PRESET_FAV_KEY, JSON.stringify(ids))
  } else {
    // AI 生成收藏：出现在收藏区即为已收藏，点 ☆ 即取消
    const lib = loadLibrary().filter((x) => x.id !== job.id)
    localStorage.setItem(LS_KEY, JSON.stringify(lib))
  }
  renderPresetGrid(false)
  renderFavGrid()
}

// 岗位库：扇形轮播（29 张依次排开，hover 居中）+ 「查看全部」切 grid 平铺
function renderPresetGrid(animate = false) {
  presetGridEl.innerHTML = ''
  for (const [idx, job] of jobsData.jobs.entries()) {
    const card = buildFanCard(job, idx)
    if (animate) card.classList.add('reveal-item')
    presetGridEl.append(card)
  }
  setFanLayout()
}

function buildFanCard(job, idx) {
  const starred = getPresetFavorites().includes(job.id)
  const card = el('button', 'fan-card')
  card.type = 'button'
  card.dataset.id = job.id
  card.dataset.idx = String(idx)
  card.style.setProperty('--idx', String(idx))

  // 右上角迷你 ☆
  const star = el('span', 'fan-card-star', starred ? '★' : '☆')
  if (starred) star.classList.add('starred')
  star.title = starred ? '取消收藏' : '收藏'
  star.addEventListener('click', (ev) => {
    ev.stopPropagation()
    toggleFavorite(job, true)
  })
  // 防止按钮内嵌 button 让 form 行为奇怪，给 star 改名
  star.setAttribute('role', 'button')

  const name = el('span', 'fan-card-name', job.name)
  card.append(star, name)

  // hover 改变居中索引，并暂停自动轮播
  card.addEventListener('mouseenter', () => {
    if (presetExpanded) return
    clearAutoFan()
    setActiveFan(idx)
  })
  card.addEventListener('mouseleave', () => {
    if (presetExpanded) return
    // 鼠标离开后 2.5s 恢复自动轮播，给用户看一会儿
    scheduleAutoFan(2500)
  })
  card.addEventListener('focus', () => {
    if (presetExpanded) return
    clearAutoFan()
    setActiveFan(idx)
  })
  card.addEventListener('blur', () => {
    if (presetExpanded) return
    scheduleAutoFan(FAN_RESUME_MS)
  })
  // 键盘可达性：Enter / Space 打开岗位拆解（鼠标/触摸点击由下方轮播 IIFE 统一处理）
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      openPresetDecomposition(job)
    }
  })
  return card
}

// 点击 / 键盘激活岗位卡片 → 把岗位名注入上方 composer 并渲染具体拆解
function openPresetDecomposition(job) {
  if (typeof inputEl !== 'undefined' && inputEl) inputEl.value = job.name
  renderResult(job, { preset: true })
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// fan 模式：根据 activeFanIdx 重算每张卡片的 --offset-raw / --abs-offset
function setFanLayout() {
  presetGridEl.dataset.mode = presetExpanded ? 'grid' : 'fan'
  const cards = presetGridEl.querySelectorAll('.fan-card')
  cards.forEach((c, i) => {
    const offset = i - activeFanIdx
    c.style.setProperty('--offset-raw', String(offset))
    c.style.setProperty('--abs-offset', String(Math.abs(offset)))
    c.classList.toggle('is-active', !presetExpanded && offset === 0)
    c.classList.toggle('is-far', Math.abs(offset) > 3)
  })
  if (viewAllBtn) {
    viewAllBtn.setAttribute('aria-expanded', presetExpanded ? 'true' : 'false')
    const label = viewAllBtn.querySelector('.view-all-label')
    if (label) label.textContent = presetExpanded ? '收起' : '查看全部'
  }
  const stage = viewAllBtn && viewAllBtn.parentElement
  if (stage) stage.classList.toggle('is-expanded', presetExpanded)
}

function setActiveFan(idx) {
  activeFanIdx = idx
  setFanLayout()
}

// 自动轮播：每 2s 主动切下一张；hover / 键盘 / 手动时延后
let autoFanTimer = null
const FAN_AUTO_MS = 2000
const FAN_RESUME_MS = 3000 // 手动操作后留出的"反应时间"

function clearAutoFan() {
  if (autoFanTimer) {
    clearTimeout(autoFanTimer)
    autoFanTimer = null
  }
}
function scheduleAutoFan(delay = FAN_AUTO_MS) {
  clearAutoFan()
  if (presetExpanded) return
  autoFanTimer = setTimeout(() => {
    autoFanTimer = null
    activeFanIdx = (activeFanIdx + 1) % jobsData.jobs.length
    setFanLayout()
    scheduleAutoFan(FAN_AUTO_MS)
  }, delay)
}

function togglePresetExpand() {
  presetExpanded = !presetExpanded
  setFanLayout()
  if (presetExpanded) {
    clearAutoFan()
    attachReveal(presetGridEl)
  } else {
    scheduleAutoFan(FAN_AUTO_MS)
  }
}

// 展开后的渐显：进入视口的格子逐个显现（含批内交错延迟）
function attachReveal(grid) {
  const items = grid.querySelectorAll('.reveal-item')
  if (!('IntersectionObserver' in window)) {
    items.forEach((it) => it.classList.add('revealed'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        io.unobserve(en.target)
        const siblings = Array.from(en.target.parentElement.children).filter((c) =>
          c.classList.contains('reveal-item'),
        )
        const idx = siblings.indexOf(en.target)
        en.target.style.transitionDelay = (idx % 10) * 40 + 'ms'
        en.target.classList.add('revealed')
        setTimeout(() => {
          en.target.style.transitionDelay = ''
        }, 1200)
      }
    },
    { threshold: 0.15 },
  )
  items.forEach((it) => io.observe(it))
}

// 岗位收藏：预置收藏（按收藏顺序）+ AI 生成收藏
function renderFavGrid() {
  favGridEl.innerHTML = ''
  const presetFavs = getPresetFavorites()
    .map((id) => jobsData.jobs.find((j) => j.id === id))
    .filter(Boolean)
  const aiFavs = loadLibrary()
  favEmptyEl.hidden = presetFavs.length + aiFavs.length > 0
  for (const job of presetFavs) favGridEl.append(jobSquare(job, { preset: true, selectable: compareMode }))
  for (const entry of aiFavs) favGridEl.append(jobSquare(entry, { preset: false, selectable: compareMode }))
  // P1：收藏 ≥ 2 个才提供对比入口
  const favCount = presetFavs.length + aiFavs.length
  jobCompareActionsEl.hidden = favCount < 2
  if (compareMode) {
    // 剔除已被取消收藏的选择，防止对比悬空
    const valid = new Set([...presetFavs.map((j) => favKey(j, true)), ...aiFavs.map((j) => favKey(j, false))])
    comparePicks = comparePicks.filter((p) => valid.has(p.key))
    jobCompareHintEl.textContent = comparePicks.length
      ? `已选 ${comparePicks.length} / 2：${comparePicks.map((p) => p.job.name).join('、')}`
      : '点击上方收藏的岗位，选 2 个进行对比'
    if (comparePicks.length < 2) {
      jobCompareResultEl.hidden = true
      jobCompareResultEl.innerHTML = ''
    }
  }
}

// ===== P1：岗位对比（收藏区选 2 个，同维度并排看差异） =====
const jobCompareActionsEl = $('job-compare-actions')
const jobCompareHintEl = $('job-compare-hint')
const jobCompareToggleEl = $('job-compare-toggle')
const jobCompareExitEl = $('job-compare-exit')
const jobCompareResultEl = $('job-compare-result')

let compareMode = false
let comparePicks = [] // [{key, job}]，最多 2 个

function favKey(job, preset) {
  return (preset ? 'p:' : 'a:') + job.id
}

function setCompareMode(on) {
  compareMode = on
  if (!on) comparePicks = []
  jobCompareToggleEl.hidden = on
  jobCompareExitEl.hidden = !on
  jobCompareResultEl.hidden = true
  jobCompareResultEl.innerHTML = ''
  renderFavGrid()
}

function toggleComparePick(job, preset) {
  const key = favKey(job, preset)
  const i = comparePicks.findIndex((x) => x.key === key)
  if (i >= 0) comparePicks.splice(i, 1)
  else {
    if (comparePicks.length >= 2) comparePicks.shift() // 先进先出，保持最多 2 个
    comparePicks.push({ key, job })
  }
  renderFavGrid()
  if (comparePicks.length === 2) renderJobCompare(comparePicks[0].job, comparePicks[1].job)
}

function buildCompareCard(job, other, selected) {
  const card = el('section', 'module-card job-compare-card' + (selected ? ' is-selected' : ''))
  const head = el('div', 'module-head')
  head.append(el('span', 'module-title', job.name))
  if (selected) head.append(el('span', 'job-compare-badge', '已选定'))
  card.append(head)

  const body = el('div', 'module-body job-compare-card-body')
  const inner = el('div', 'module-body-inner')
  const rows = [
    { title: '一句话本质', get: (j) => (j.oneLineTruth ? [j.oneLineTruth] : []) },
    ...MODULES.map((m) => ({ title: m.title, get: (j) => (Array.isArray(j[m.key]) ? j[m.key] : []) })),
  ]

  for (const r of rows) {
    const mine = r.get(job)
    const theirs = r.get(other)
    if (!mine.length && !theirs.length) continue

    const section = el('div', 'job-compare-section')
    section.append(el('div', 'job-compare-section-title', r.title))
    const ul = el('ul', 'job-compare-list')
    if (mine.length) {
      for (const it of mine) {
        const li = el('li', '', it)
        ul.append(li)
      }
    } else {
      const li = el('li', 'is-missing', '暂无')
      ul.append(li)
    }
    section.append(ul)
    inner.append(section)
  }

  body.append(inner)
  card.append(body)
  return card
}

function renderJobCompare(a, b) {
  jobCompareResultEl.innerHTML = ''
  const head = el('div', 'job-compare-head')
  head.append(el('h3', 'job-compare-title', `${a.name} vs ${b.name}`))
  head.append(el('p', 'job-compare-sub', '同维度并排看差异，帮你决定先深入哪一个'))
  jobCompareResultEl.append(head)

  const wrap = el('div', 'job-compare-cards')
  wrap.append(buildCompareCard(a, b, false))
  const vs = el('div', 'job-compare-vs', 'VS')
  wrap.append(vs)
  wrap.append(buildCompareCard(b, a, true))

  jobCompareResultEl.append(wrap)
  jobCompareResultEl.hidden = false
  jobCompareResultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

jobCompareToggleEl.addEventListener('click', () => setCompareMode(true))
jobCompareExitEl.addEventListener('click', () => setCompareMode(false))

// ===== 事件绑定与初始化 =====
generateBtn.addEventListener('click', routeBreakdown)
// textarea 里 Enter 换行，Ctrl/Cmd + Enter 才提交
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) routeBreakdown()
})

initThemeSwitcher()
renderPresetGrid(false)
renderFavGrid()

// 岗位库：「查看全部 / 收起」按钮
if (viewAllBtn) viewAllBtn.addEventListener('click', togglePresetExpand)

// 岗位库：键盘左右切换中央卡片（仅 fan 模式生效）
document.addEventListener('keydown', (e) => {
  if (presetExpanded) return
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName || '')) return
  const stage = document.getElementById('screen-3')
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  // 仅当岗位库在视口内才响应
  if (rect.bottom < 0 || rect.top > innerHeight) return
  const total = jobsData.jobs.length
  if (e.key === 'ArrowLeft') {
    setActiveFan((activeFanIdx - 1 + total) % total)
    scheduleAutoFan(FAN_RESUME_MS)
    e.preventDefault()
  } else if (e.key === 'ArrowRight') {
    setActiveFan((activeFanIdx + 1) % total)
    scheduleAutoFan(FAN_RESUME_MS)
    e.preventDefault()
  }
})

// 启动岗位库自动轮播（页面加载完成且非 grid 时）
scheduleAutoFan(FAN_AUTO_MS)

// 岗位库轮播：鼠标拖动 / 触摸滑动切换；非拖拽的单击视为"打开该岗位拆解"
;(() => {
  const carousel = presetGridEl
  if (!carousel) return
  const CARD_SPACING = 88 // 与 CSS 中 fan-card translateX 系数一致，拖动 88px 切换一张
  let dragActive = false
  let dragMoved = false
  let startX = 0
  let startIdx = 0
  let currentDelta = 0

  carousel.addEventListener('pointerdown', (e) => {
    if (presetExpanded) return
    // 不拦截收藏星（由卡片内独立处理）
    if (e.target.closest('.fan-card-star')) return
    dragActive = true
    dragMoved = false
    startX = e.clientX
    startIdx = activeFanIdx
    currentDelta = 0
    try { carousel.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    carousel.classList.add('is-dragging')
    clearAutoFan()
  })

  carousel.addEventListener('pointermove', (e) => {
    if (!dragActive) return
    const dx = e.clientX - startX
    if (Math.abs(dx) > 8) dragMoved = true
    currentDelta = dx
    // 实时更新 activeFanIdx，让扇形卡片跟随手指/鼠标左右移动
    const total = jobsData.jobs.length
    const progress = dx / CARD_SPACING
    activeFanIdx = (startIdx - progress + total * 1000) % total
    setFanLayout()
  })

  carousel.addEventListener('pointerup', (e) => {
    if (!dragActive) return
    dragActive = false
    carousel.classList.remove('is-dragging')
    try { carousel.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (dragMoved) {
      const total = jobsData.jobs.length
      const steps = Math.round(currentDelta / CARD_SPACING)
      // 向右拖 → 上一张；向左拖 → 下一张；没超过半张则弹回原位
      const newIdx = Math.round(((startIdx - steps) % total + total) % total)
      setActiveFan(newIdx)
      scheduleAutoFan(FAN_RESUME_MS)
      return
    }
    // 非拖拽 = 单击：命中指针下方的卡片并打开其拆解
    // 注意 setPointerCapture 会让 e.target 指向 carousel 本身，故用 elementFromPoint 取真实卡片
    const elem = document.elementFromPoint(e.clientX, e.clientY)
    const hitCard = elem && elem.closest('.fan-card')
    if (!hitCard) return
    const idx = Number(hitCard.dataset.idx)
    const job = jobsData.jobs[idx]
    if (job) openPresetDecomposition(job)
  })

  carousel.addEventListener('pointercancel', () => {
    dragActive = false
    carousel.classList.remove('is-dragging')
    // 若已产生位移，弹回起点，避免悬停在非整数索引
    if (dragMoved) setActiveFan(startIdx)
    scheduleAutoFan(FAN_RESUME_MS)
  })
})()

// ===== 全局浮窗导航（React FloatingNav）已接管锚点滚动 / 当前屏高亮 / 拖拽 / 锁定 =====
// 首屏入场 / 顶栏显隐 / 汉堡菜单 等旧逻辑全部移除——只有这唯一一条导航

// ============================================================
// 工作台（含项目台账，原第 2/4 屏合并）
// ============================================================
// ===== localStorage key 清单 =====
// job_library        AI 生成收藏（第 3 屏，已有）
// preset_favorites   预置岗位收藏 id（第 3 屏，已有）
// theme_preview      配色预览开关（临时，?theme=1 唤出，定稿配色后整体删除）
// odb_todos          待办：{id,title,dueDate,priority,note,done,createdAt,doneAt}
// odb_activities     动态：{type,title,time}（最多保留 50 条）
// odb_projects       项目台账：{id,name,stage,deadline,owner,risks,todoIds,createdAt,updatedAt}
// odb_meetings       会议纪要：{id,title,date,conclusions,actionItems,openQuestions,createdAt}（保留最近 20 条）
// odb_reports        周报：{id,weekStart,weekly,upward,createdAt}（保留最近 8 条）
// odb_book_notes     读书笔记：{bookId: '一句话笔记'}（P1，纯本地）
// odb_onboarded      首次访问引导是否已展示（UI 标记，不参与导出）
// odb_book_status    书单阅读状态：{bookId: 'want'|'reading'|'read'}（books.json 的 status 仅为默认值）
// odb_dilemma_fav    困境收藏：困境 id 数组
// odb_dilemma_custom AI 拆解的自定义困境：与 dilemmas.json 条目同格式 {id,title,tags,solutions[]}

// ===== 工作台 DOM =====
const dashGreetingEl = $('dash-greeting')
const dashGreetingTipEl = $('dash-greeting-tip')
const dashInputEl = $('dash-input')
const dashParseBtn = $('dash-parse-btn')
const dashSampleBtn = $('dash-sample-btn')
const dashParseStatusEl = $('dash-parse-status')
const dashConfirmEl = $('dash-confirm-list')
const dashTodoListEl = $('dash-todo-list')
const dashTodoEmptyEl = $('dash-todo-empty')
const dashCalCardEl = $('dash-cal-card')
const dashCalGridEl = $('dash-cal-grid')
const dashCalTitleEl = $('dash-cal-title')
const dashCalPopEl = $('dash-cal-pop')

let confirmTodos = [] // 解析后待确认列表
let todoFilter = 'all' // all / todo / done
let parsing = false
let calPopupKey = ''
const calNow = new Date()
let calYear = calNow.getFullYear()
let calMonth = calNow.getMonth()

// ===== 数据读写 =====
const TODOS_KEY = 'odb_todos'
const ACT_KEY = 'odb_activities'

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(TODOS_KEY)) || []
  } catch {
    return []
  }
}

function saveTodos(list) {
  localStorage.setItem(TODOS_KEY, JSON.stringify(list))
}

function loadActivities() {
  try {
    return JSON.parse(localStorage.getItem(ACT_KEY)) || []
  } catch {
    return []
  }
}

function saveActivities(list) {
  localStorage.setItem(ACT_KEY, JSON.stringify(list.slice(0, 50)))
}

function logActivity(type, title) {
  const list = loadActivities()
  list.unshift({ type, title, time: Date.now() })
  saveActivities(list)
}

// ===== 问候语（按访问时段） =====
const GREETINGS = {
  morning: {
    hello: '早上好，准备上道了',
    tips: [
      '今天第一件事：打开待办，挑最难的先干',
      '昨天没回的消息，今天上午回掉',
      '例会前 5 分钟，把要同步的三件事写下来',
    ],
  },
  afternoon: {
    hello: '下午好，稳住节奏',
    tips: [
      '下午的会别只带耳朵去，带一个要问的问题',
      '午休回来先看一眼今天还剩几件事',
      '把上午卡住的活，拆成半小时能做完的一小块',
    ],
  },
  evening: {
    hello: '晚上好，今天辛苦了',
    tips: [
      '下班前花 3 分钟勾掉做完的事，明天的你会感谢现在的你',
      '今天没干完的，判断一下：是真干不完，还是不敢开始',
      '把明天的第一件事写下来，明早不用想',
    ],
  },
}

function renderGreeting() {
  const h = new Date().getHours()
  const slot = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  const g = GREETINGS[slot]
  dashGreetingEl.textContent = 'WORKBENCH  工作台'
  dashGreetingTipEl.textContent = g.tips[Math.floor(Math.random() * g.tips.length)]
}

// ===== 日期工具 =====
// 本地日期 YYYY-MM-DD（月份从 0 开始，注意 +1）
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 本周一 00:00
function mondayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')
  return Math.round(ms / 86400000)
}

// ===== 粘贴排期 → AI 智能解析（自动分拣待办 / 台账） =====
const SAMPLE_TEXT = `周三前把竞品分析发给王总，他说要在部门会上用
下周一例会要汇报进度，ppt还没开始做
回复采购部那封邮件，已经催了两遍
项目A 宣传片拍摄 9月5号 张伟 人手不够可能延期
新品发布会物料 2026/9/15截止 李娜负责
品牌宣传片：初稿完了这周开始拍 王强 甲方场地没定有风险
今天下午3点和设计对需求，先把页面稿过一遍
公众号改版 下周五前上线 小周
mentor 让整理上周会议纪要，说下周二前给他`

async function smartParse() {
  const text = dashInputEl.value.trim()
  if (!text) {
    dashInputEl.focus()
    return
  }
  if (parsing) return
  if (DEMO_MODE) {
    demoSmartParse(text)
    return
  }
  parsing = true
  dashParseBtn.disabled = true
  dashParseBtn.textContent = '解析中…'
  renderParseStatus('loading')
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: smartParsePromptRaw.replace('{{TODAY}}', todayStr()) },
          { role: 'user', content: `今天是 ${todayStr()}。请整理以下工作文本：\n\n${text}` },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空，请重试')
    const parsed = parseJsonSafe(content)
    renderSmartConfirm(parsed)
  } catch (err) {
    renderParseStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    parsing = false
    dashParseBtn.disabled = false
    dashParseBtn.textContent = '智能解析'
  }
}

// 智能分发：待办进 dash-confirm-list，项目进 proj-confirm-list，各自独立确认
function renderSmartConfirm(parsed) {
  const todos = Array.isArray(parsed.todos) ? parsed.todos : []
  const projects = Array.isArray(parsed.projects) ? parsed.projects : []
  if (!todos.length && !projects.length) {
    renderParseStatus('empty', parsed.note || '')
    return
  }
  renderParseStatus('none')
  if (todos.length) renderConfirmList(todos)
  if (projects.length) renderConfirmProjects(projects)
}

// 解析状态：key / loading / error / empty / success
function renderParseStatus(kind, msg = '') {
  dashParseStatusEl.innerHTML = ''
  if (kind === 'none') return
  const card = el('div', 'dash-status' + (kind === 'error' || kind === 'key' ? ' dash-status-error' : kind === 'success' ? ' dash-status-success' : ''))
  if (kind === 'loading') {
    card.append(el('div', 'dash-spinner'), el('p', 'dash-status-text', '正在解析，约需 5~10 秒…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'dash-status-icon', '🔑'),
      el('h3', 'dash-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'dash-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'error') {
    card.append(el('div', 'dash-status-icon', '⚠️'), el('h3', 'dash-status-title', '解析失败'), el('p', 'dash-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', smartParse)
    card.append(retry)
  } else if (kind === 'empty') {
    card.append(el('div', 'dash-status-icon', 'ℹ️'), el('h3', 'dash-status-title', '没提取到可执行事项'), el('p', 'dash-status-text', msg || '换一段工作文本试试'))
  } else if (kind === 'success') {
    card.append(el('div', 'dash-status-icon', '✅'), el('p', 'dash-status-text', msg))
  }
  dashParseStatusEl.append(card)
}

// 解析结果 → 可编辑待确认列表
function renderConfirmList(list) {
  renderParseStatus('none')
  confirmTodos = list.map((t) => ({
    title: t.title || '',
    dueDate: t.dueDate || null,
    priority: ['高', '中', '低'].includes(t.priority) ? t.priority : '低',
    note: t.note || null,
  }))
  dashConfirmEl.innerHTML = ''
  const head = el('div', 'dash-confirm-head')
  head.append(el('span', '', `解析出 ${confirmTodos.length} 条，确认或修改后入库`))
  dashConfirmEl.append(head)
  confirmTodos.forEach((c, i) => {
    const row = el('div', 'dash-confirm-row')
    const titleInput = el('input', 'dash-confirm-title')
    titleInput.value = c.title
    titleInput.placeholder = '事项名'
    titleInput.addEventListener('input', () => {
      c.title = titleInput.value
    })
    const dateInput = el('input', 'dash-confirm-date')
    dateInput.type = 'date'
    dateInput.value = c.dueDate || ''
    dateInput.addEventListener('change', () => {
      c.dueDate = dateInput.value || null
    })
    const prioSel = el('select', 'dash-confirm-prio')
    for (const p of ['高', '中', '低']) {
      const opt = el('option', '', p)
      opt.value = p
      prioSel.append(opt)
    }
    prioSel.value = c.priority
    prioSel.addEventListener('change', () => {
      c.priority = prioSel.value
    })
    const del = el('button', 'dash-confirm-del', '删除')
    del.type = 'button'
    del.addEventListener('click', () => {
      confirmTodos.splice(i, 1)
      renderConfirmList(confirmTodos)
    })
    row.append(titleInput, dateInput, prioSel, del)
    if (c.note) row.append(el('p', 'dash-confirm-note', c.note))
    dashConfirmEl.append(row)
  })
  const footer = el('div', 'dash-confirm-footer')
  const addBtn = el('button', 'btn-primary', '确认添加')
  addBtn.type = 'button'
  addBtn.addEventListener('click', confirmAddTodos)
  footer.append(addBtn)
  dashConfirmEl.append(footer)
}

function confirmAddTodos() {
  const todos = loadTodos()
  const now = Date.now()
  let added = 0
  for (const c of confirmTodos) {
    const title = c.title.trim()
    if (!title) continue
    todos.unshift({
      id: 't' + now + '-' + added,
      title,
      dueDate: c.dueDate || null,
      priority: c.priority,
      note: c.note || null,
      done: false,
      createdAt: now,
      doneAt: null,
    })
    added++
  }
  if (!added) {
    renderParseStatus('error', '没有可添加的待办，请检查每条标题')
    return
  }
  saveTodos(todos)
  confirmTodos = []
  dashConfirmEl.innerHTML = ''
  renderParseStatus('none')
  logActivity('todo-add', `新增 ${added} 条待办`)
  refreshDashboard()
}

// ===== 共享统计组件（工作台 + 周报屏复用） =====
const RING_C = 2 * Math.PI * 26

// 共享数据计算：本周完成度、风险、延期、待办等所有统计项的原始数据
function buildCommonStats() {
  const todos = loadTodos()
  const today = todayStr()
  const monday = mondayStart()
  const active = todos.filter((t) => !t.done)
  const weekCreated = todos.filter((t) => t.createdAt >= monday.getTime())
  const weekDone = weekCreated.filter((t) => t.done)
  const dueToday = active.filter((t) => t.dueDate === today).length
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today).length

  // 台账项目的 deadline 计入「延期风险」（逾期 / 3 天内临期）
  const projRisk = loadProjects().filter((p) => {
    if (!p.deadline) return false
    if (p.deadline < today) return true
    return daysBetween(today, p.deadline) <= 3
  })
  const projOverdue = projRisk.filter((p) => p.deadline < today).length
  const projSoon = projRisk.length - projOverdue
  const riskTotal = overdue + projRisk.length

  const total = weekCreated.length
  const completion = total === 0 ? 0 : Math.round((weekDone.length / total) * 100)
  const ratio = total === 0 ? 0 : weekDone.length / total

  let riskSub
  if (riskTotal === 0) {
    riskSub = '暂无风险'
  } else {
    const parts = []
    if (overdue) parts.push(`待办逾期 ${overdue}`)
    if (projOverdue) parts.push(`项目逾期 ${projOverdue}`)
    if (projSoon) parts.push(`项目临期 ${projSoon}`)
    riskSub = parts.join(' · ')
  }

  return {
    todos, active, weekCreated, weekDone, dueToday,
    overdue, projOverdue, projSoon, riskTotal, riskSub,
    completion, ratio, total,
  }
}

// 单卡片工厂：variant = 'dash'（4 列网格玻璃卡）或 'rep'（横向胶囊）
// stat = { key, label, value, sub?, ring?, danger? }
function renderStatCard(variant, stat) {
  const isRep = variant === 'rep'
  const p = isRep ? 'rep' : 'dash'
  const card = el('div', isRep ? 'rep-stat' : 'dash-stat-card')
  if (stat.danger) card.classList.add('danger')

  if (stat.ring) {
    const wrap = el('div', `${p}-ring-wrap`)
    const svgNs = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNs, 'svg')
    svg.setAttribute('class', `${p}-ring`)
    svg.setAttribute('viewBox', '0 0 64 64')
    svg.setAttribute('aria-hidden', 'true')
    const bg = document.createElementNS(svgNs, 'circle')
    bg.setAttribute('class', `${p}-ring-bg`)
    bg.setAttribute('cx', '32'); bg.setAttribute('cy', '32'); bg.setAttribute('r', '26')
    const fg = document.createElementNS(svgNs, 'circle')
    fg.setAttribute('class', `${p}-ring-fg`)
    fg.setAttribute('cx', '32'); fg.setAttribute('cy', '32'); fg.setAttribute('r', '26')
    svg.append(bg, fg)
    const num = el('span', `${p}-ring-num`, stat.value)
    wrap.append(svg, num)
    card.append(wrap, el(isRep ? 'span' : 'div', `${p}-stat-label`, stat.label))
  } else {
    card.append(
      el('div', `${p}-stat-num`, String(stat.value)),
      el(isRep ? 'span' : 'div', `${p}-stat-label`, stat.label),
    )
    if (!isRep && stat.sub) {
      card.append(el('div', `${p}-stat-sub`, stat.sub))
    }
  }
  return card
}

function renderStatsGrid(container, variant, stats) {
  if (!container) return
  container.innerHTML = ''
  for (const stat of stats) {
    container.append(renderStatCard(variant, stat))
  }
  // 更新首个 ring 卡的 stroke-dasharray（dash/rep 各自只有一个 ring 卡）
  const ringFg = container.querySelector('.dash-ring-fg, .rep-ring-fg')
  if (ringFg) {
    const target = stats.find((s) => s.ring)
    if (target && typeof target.ringRatio === 'number') {
      const ratio = target.ringRatio
      ringFg.setAttribute('stroke-dasharray', `${(ratio * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`)
    }
  }
}

// ===== 工作台统计（4 卡：进行中 / 待办 / 延期风险 / 本周完成度） =====
function refreshStats() {
  const s = buildCommonStats()
  const stats = [
    { key: 'progress', label: '进行中', value: s.active.length, sub: `今日到期 ${s.dueToday}` },
    { key: 'todo', label: '待办', value: s.weekCreated.length, sub: `本周新增 ${s.weekCreated.length}` },
    { key: 'overdue', label: '延期风险', value: s.riskTotal, sub: s.riskSub, danger: s.riskTotal > 0 },
    { key: 'week', label: '本周完成度', value: s.total === 0 ? '—' : `${s.completion}%`, ring: true, ringRatio: s.ratio },
  ]
  renderStatsGrid($('dash-stats'), 'dash', stats)
}

// ===== 待办列表 =====
function renderTodoList() {
  const todos = loadTodos()
  const today = todayStr()
  const filtered = todos.filter((t) => (todoFilter === 'all' ? true : todoFilter === 'done' ? t.done : !t.done))
  dashTodoListEl.innerHTML = ''
  dashTodoEmptyEl.hidden = filtered.length > 0
  dashTodoEmptyEl.innerHTML =
    todos.length === 0
      ? emptyStateHTML('<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="rgba(225,224,204,0.6)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="11" y="9" width="26" height="31" rx="3"/><rect x="19" y="5" width="10" height="6" rx="2"/><path d="M16 22l3 3 5-6"/><line x1="25" y1="24" x2="33" y2="24"/><line x1="16" y1="31" x2="33" y2="31"/><line x1="16" y1="37" x2="33" y2="37"/></svg>', '还没有待办', '粘贴上面的排期，点「解析」试试')
      : emptyStateHTML('📋', '这个筛选下没有待办')
  for (const t of filtered) {
    const li = el('li', 'dash-todo' + (t.done ? ' done' : ''))
    const cb = el('input', 'dash-todo-check')
    cb.type = 'checkbox'
    cb.checked = t.done
    cb.addEventListener('change', () => toggleTodo(t.id))
    const prio = el(
      'span',
      'dash-prio ' + (t.priority === '高' ? 'prio-high' : t.priority === '中' ? 'prio-mid' : 'prio-low'),
    )
    const body = el('div', 'dash-todo-body')
    const titleLine = el('div', 'dash-todo-title-line')
    titleLine.append(el('span', 'dash-todo-title', t.title))
    if (t.dueDate) {
      const due = el('span', 'dash-todo-due')
      if (!t.done && t.dueDate < today) {
        due.textContent = `截止 ${t.dueDate} · 已逾期 ${daysBetween(t.dueDate, today)} 天`
        due.classList.add('overdue')
      } else if (t.dueDate === today) {
        due.textContent = '今天截止'
        due.classList.add('today-due')
      } else {
        due.textContent = '截止 ' + t.dueDate
      }
      titleLine.append(due)
    }
    body.append(titleLine)
    if (t.note) body.append(el('p', 'dash-todo-note', t.note))
    const del = el('button', 'dash-todo-del', '删除')
    del.type = 'button'
    del.addEventListener('click', () => deleteTodo(t.id))
    li.append(cb, prio, body, del)
    dashTodoListEl.append(li)
  }
}

function toggleTodo(id) {
  const todos = loadTodos()
  const t = todos.find((x) => x.id === id)
  if (!t) return
  t.done = !t.done
  t.doneAt = t.done ? Date.now() : null
  saveTodos(todos)
  if (t.done) logActivity('todo-done', `完成待办：${t.title.slice(0, 20)}`)
  refreshDashboard()
}

function deleteTodo(id) {
  const todos = loadTodos().filter((x) => x.id !== id)
  saveTodos(todos)
  refreshDashboard()
}

// ===== 本月日历（纯 JS，周一为一周起点） =====
function renderCalendar() {
  const todos = loadTodos()
  const dueMap = {}
  for (const t of todos) {
    if (!t.dueDate) continue
    if (!dueMap[t.dueDate]) dueMap[t.dueDate] = []
    dueMap[t.dueDate].push(t)
  }
  dashCalTitleEl.textContent = `${calYear}年${calMonth + 1}月`
  dashCalGridEl.innerHTML = ''
  const first = new Date(calYear, calMonth, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(calYear, calMonth + 1, 0).getDate()
  const total = Math.ceil((offset + days) / 7) * 7
  const today = todayStr()
  for (let i = 0; i < total; i++) {
    const day = i - offset + 1
    const cell = el('div', 'dash-cal-cell')
    if (day < 1 || day > days) {
      cell.classList.add('blank')
      dashCalGridEl.append(cell)
      continue
    }
    cell.classList.add('day')
    const key = calDateKey(day)
    if (key === today) cell.classList.add('today')
    cell.append(el('span', 'dash-cal-day', String(day)))
    const dayTodos = dueMap[key] || []
    // 在日期格内直接展示这一天拆解出来的待办事项
    if (dayTodos.length) {
      const box = el('div', 'dash-cal-todos')
      const shown = dayTodos.slice(0, 2)
      for (const t of shown) {
        const chip = el('span', 'dash-cal-todo' + (t.done ? ' done' : ''), t.title)
        chip.title = t.title + (t.done ? '（已完成）' : '')
        chip.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleTodo(t.id)
        })
        box.append(chip)
      }
      if (dayTodos.length > 2) box.append(el('span', 'dash-cal-todo-more', `+${dayTodos.length - 2}`))
      cell.append(box)
    }
    cell.addEventListener('click', () => toggleCalPopup(key, dayTodos))
    dashCalGridEl.append(cell)
  }
  hideCalPopup()
}

function calDateKey(day) {
  return `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// 在日历指定日期新增一条待办
function addTodoForDate(dateKey, title) {
  title = (title || '').trim()
  if (!title) return false
  const todos = loadTodos()
  const now = Date.now()
  todos.unshift({
    id: 't' + now + '-' + Math.random().toString(36).slice(2, 7),
    title,
    dueDate: dateKey,
    priority: null,
    note: null,
    done: false,
    createdAt: now,
    doneAt: null,
  })
  saveTodos(todos)
  logActivity('todo-add', `新增待办：${title.slice(0, 20)}`)
  refreshDashboard()
  return true
}

function toggleCalPopup(key, dayTodos) {
  if (calPopupKey === key && !dashCalPopEl.hidden) {
    hideCalPopup()
    return
  }
  calPopupKey = key
  const d = parseInt(key.slice(8), 10)
  const undone = dayTodos.filter((t) => !t.done)
  dashCalPopEl.innerHTML = ''
  dashCalPopEl.append(
    el('div', 'dash-cal-pop-title', `${calMonth + 1} 月 ${d} 日 · ${dayTodos.length} 条待办，${undone.length} 条未完成`),
  )
  const ul = el('ul', 'dash-cal-pop-list')
  for (const t of dayTodos) {
    const li = el('li', t.done ? 'done' : '')
    const mark = el('span', 'dash-cal-pop-mark', t.done ? '✓' : '○')
    mark.style.cursor = 'pointer'
    mark.addEventListener('click', () => {
      toggleTodo(t.id)
      toggleCalPopup(key, loadTodos().filter((x) => x.dueDate === key))
    })
    const title = el('span', 'dash-cal-pop-title-text', t.title)
    title.style.cursor = 'pointer'
    title.addEventListener('click', () => {
      toggleTodo(t.id)
      toggleCalPopup(key, loadTodos().filter((x) => x.dueDate === key))
    })
    const del = el('button', 'dash-cal-pop-del', '删除')
    del.type = 'button'
    del.addEventListener('click', () => {
      deleteTodo(t.id)
      toggleCalPopup(key, loadTodos().filter((x) => x.dueDate === key))
    })
    li.append(mark, title, del)
    ul.append(li)
  }
  dashCalPopEl.append(ul)

  // 在日历中为该日期增加待办
  const addWrap = el('div', 'dash-cal-pop-add')
  const input = el('input', 'dash-cal-pop-input')
  input.type = 'text'
  input.placeholder = '在这一天加一条待办…'
  const addBtn = el('button', 'btn-primary dash-cal-pop-addbtn', '添加')
  addBtn.type = 'button'
  const doAdd = () => {
    if (addTodoForDate(key, input.value)) {
      input.value = ''
      toggleCalPopup(key, loadTodos().filter((t) => t.dueDate === key))
    }
  }
  addBtn.addEventListener('click', doAdd)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd()
  })
  addWrap.append(input, addBtn)
  dashCalPopEl.append(addWrap)

  dashCalPopEl.hidden = false
}

function hideCalPopup() {
  calPopupKey = ''
  dashCalPopEl.hidden = true
}

// 动态图标映射（数据仍写入 odb_activities 供导出；「最近动态」UI 已下线）
const ACT_ICONS = { 'todo-add': '📝', 'todo-done': '✅', 'job-save': '⭐' }

// ===== 汇总刷新与事件绑定 =====
function refreshDashboard() {
  refreshStats()
  renderTodoList()
  renderCalendar()
  renderOnboardingProgress()
}

dashParseBtn.addEventListener('click', smartParse)
dashSampleBtn.addEventListener('click', () => {
  dashInputEl.value = SAMPLE_TEXT
  dashInputEl.focus()
})
document.querySelectorAll('.dash-tab').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.dash-tab').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    todoFilter = b.dataset.filter
    renderTodoList()
  })
})
$('dash-stats').addEventListener('click', (e) => {
  const card = e.target.closest('.dash-stat-card.danger')
  if (card) $('proj-panel').scrollIntoView({ behavior: 'smooth', block: 'center' })
})
$('dash-cal-prev').addEventListener('click', () => {
  calMonth--
  if (calMonth < 0) {
    calMonth = 11
    calYear--
  }
  renderCalendar()
})
$('dash-cal-next').addEventListener('click', () => {
  calMonth++
  if (calMonth > 11) {
    calMonth = 0
    calYear++
  }
  renderCalendar()
})
document.addEventListener('click', (e) => {
  if (!dashCalCardEl.contains(e.target)) hideCalPopup()
})

renderGreeting()
// 注意:refreshDashboard() 的首次调用已移到文件末尾——
// refreshStats 依赖第 4 屏的 PROJECTS_KEY(此处尚在 TDZ),提前调用会被 loadProjects 的 try/catch 静默吞掉

// ============================================================
// 工作台 · 项目台账（原第 4 屏，已并入工作台）
// ============================================================
// 阶段常量（内容模板：v1 固定 5 阶段，以后可扩展自定义）
const PROJECT_STAGES = [
  { key: 'plan', label: '大纲' },
  { key: 'draft', label: '脚本' },
  { key: 'shoot', label: '拍摄' },
  { key: 'v1', label: '初稿' },
  { key: 'launch', label: '发布' },
]

const PROJECTS_KEY = 'odb_projects'

// ===== 台账 DOM（已并入工作台） =====
const projParseStatusEl = $('proj-parse-status')
const projConfirmEl = $('proj-confirm-list')
const projStageTabsEl = $('proj-stage-tabs')
const projOwnerFilterEl = $('proj-owner-filter')
const projSearchEl = $('proj-search')
const projListEl = $('proj-list')
const projEmptyEl = $('proj-empty')

let confirmProjects = [] // 整理后待确认列表
let projFilterStage = 'all'

// 动态图标扩展（只新增键）
ACT_ICONS['proj-add'] = '📁'
ACT_ICONS['proj-del'] = '🗑️'

// ===== 数据读写 =====
function loadProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || []
  } catch {
    return []
  }
}

function saveProjects(list) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(list))
  refreshStats() // 台账变化即时反映到工作台「延期风险」
}

// ===== 粘贴工作清单 → AI 整理（已并入工作台「智能解析」） =====
const PROJ_SAMPLE_TEXT = `项目a 短视频脚本 8月30日前交脚本 张伟
项目A 拍摄 9月5号 张伟 人手不够可能延期
新品发布会物料 2026/9/15截止 李娜负责
品牌宣传片：初稿完了这周开始拍 王强 甲方场地没定有风险
公众号改版 下周五前上线 小周
项目a 剪辑 9月10日交付`

function renderProjStatus(kind, msg = '') {
  // 台账并入工作台后无独立状态区，状态统一走 dash-parse-status
  if (!projParseStatusEl) return
  projParseStatusEl.innerHTML = ''
  if (kind === 'none') return
  const card = el(
    'div',
    'proj-status' +
      (kind === 'error' || kind === 'key' ? ' proj-status-error' : kind === 'success' ? ' proj-status-success' : ''),
  )
  if (kind === 'loading') {
    card.append(el('div', 'proj-spinner'), el('p', 'proj-status-text', '正在整理，约需 5~10 秒…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'proj-status-icon', '🔑'),
      el('h3', 'proj-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'proj-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'error') {
    card.append(el('div', 'proj-status-icon', '⚠️'), el('h3', 'proj-status-title', '整理失败'), el('p', 'proj-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', parseProjects)
    card.append(retry)
  } else if (kind === 'empty') {
    card.append(el('div', 'proj-status-icon', 'ℹ️'), el('h3', 'proj-status-title', '没整理出可用的项目'), el('p', 'proj-status-text', msg || '换一段工作清单试试'))
  } else if (kind === 'success') {
    card.append(el('div', 'proj-status-icon', '✅'), el('p', 'proj-status-text', msg))
  }
  projParseStatusEl.append(card)
}

// 名称相似度（大小写/空白/标点无关）：相同或互相包含即判疑似重复
function normalizeName(s) {
  return s.toLowerCase().replace(/[^\w一-龥]/g, '')
}

function findDuplicateProject(name, projects) {
  const n = normalizeName(name)
  if (n.length < 4) return null
  for (const p of projects) {
    const pn = normalizeName(p.name)
    if (pn.length < 4) continue
    if (n === pn || n.includes(pn) || pn.includes(n)) return p
  }
  return null
}

// 整理结果 → 可编辑待确认列表（含疑似重复提示）
function renderConfirmProjects(list) {
  renderProjStatus('none')
  confirmProjects = list.map((p) => ({
    name: p.name || '',
    stage: PROJECT_STAGES.some((s) => s.key === p.stage) ? p.stage : 'plan',
    deadline: p.deadline || null,
    owner: p.owner || '',
    risks: Array.isArray(p.risks) ? p.risks.filter(Boolean) : [],
    note: p.note || null,
  }))
  const existing = loadProjects()
  projConfirmEl.innerHTML = ''
  const head = el('div', 'proj-confirm-head')
  head.append(el('span', '', `整理出 ${confirmProjects.length} 个项目，确认或修改后入库`))
  projConfirmEl.append(head)
  confirmProjects.forEach((c, i) => {
    const row = el('div', 'proj-confirm-row')
    const nameInput = el('input', 'proj-confirm-name')
    nameInput.value = c.name
    nameInput.placeholder = '项目名'
    nameInput.addEventListener('input', () => {
      c.name = nameInput.value
    })
    const stageSel = el('select', 'proj-confirm-stage')
    for (const s of PROJECT_STAGES) {
      const opt = el('option', '', s.label)
      opt.value = s.key
      stageSel.append(opt)
    }
    stageSel.value = c.stage
    stageSel.addEventListener('change', () => {
      c.stage = stageSel.value
    })
    const dateInput = el('input', 'proj-confirm-date')
    dateInput.type = 'date'
    dateInput.value = c.deadline || ''
    dateInput.addEventListener('change', () => {
      c.deadline = dateInput.value || null
    })
    const ownerInput = el('input', 'proj-confirm-owner')
    ownerInput.value = c.owner
    ownerInput.placeholder = '负责人'
    ownerInput.addEventListener('input', () => {
      c.owner = ownerInput.value
    })
    const risksInput = el('input', 'proj-confirm-risks')
    risksInput.value = c.risks.join('，')
    risksInput.placeholder = '风险项（逗号分隔，可空）'
    risksInput.addEventListener('input', () => {
      c.risks = risksInput.value.split(/[，,]/).map((r) => r.trim()).filter(Boolean)
    })
    const del = el('button', 'proj-confirm-del', '删除')
    del.type = 'button'
    del.addEventListener('click', () => {
      confirmProjects.splice(i, 1)
      renderConfirmProjects(confirmProjects)
    })
    row.append(nameInput, stageSel, dateInput, ownerInput, risksInput, del)
    const dup = findDuplicateProject(c.name, existing)
    if (dup) row.append(el('p', 'proj-dup-warn', `⚠ 疑似与已有项目『${dup.name}』重复，请确认是否仍要导入`))
    if (c.note) row.append(el('p', 'proj-confirm-note', c.note))
    projConfirmEl.append(row)
  })
  const footer = el('div', 'proj-confirm-footer')
  const addBtn = el('button', 'btn-primary', '确认添加')
  addBtn.type = 'button'
  addBtn.addEventListener('click', confirmAddProjects)
  footer.append(addBtn)
  projConfirmEl.append(footer)
}

function confirmAddProjects() {
  const projects = loadProjects()
  const now = Date.now()
  let added = 0
  for (const c of confirmProjects) {
    const name = c.name.trim()
    if (!name) continue
    projects.unshift({
      id: 'p' + now + '-' + added,
      name,
      stage: c.stage,
      deadline: c.deadline || null,
      owner: c.owner.trim() || null,
      risks: c.risks,
      todoIds: [],
      createdAt: now,
      updatedAt: now,
    })
    added++
  }
  if (!added) {
    renderProjStatus('error', '没有可添加的项目，请检查项目名')
    return
  }
  saveProjects(projects)
  confirmProjects = []
  projConfirmEl.innerHTML = ''
  renderProjStatus('none')
  showToast(`已添加 ${added} 个项目`)
  logActivity('proj-add', `新建 ${added} 个项目`)
  refreshProjects()
}

// ===== 项目卡片列表 =====
function renderProjectList() {
  const projects = loadProjects()
  const todos = loadTodos()
  const today = todayStr()
  let list = projects
  if (projFilterStage !== 'all') list = list.filter((p) => p.stage === projFilterStage)
  const owner = projOwnerFilterEl.value
  if (owner !== 'all') list = list.filter((p) => p.owner === owner)
  const kw = projSearchEl.value.trim().toLowerCase()
  if (kw) list = list.filter((p) => p.name.toLowerCase().includes(kw))
  projListEl.innerHTML = ''
  projEmptyEl.hidden = list.length > 0
  projEmptyEl.innerHTML =
    projects.length === 0
      ? emptyStateHTML('<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="rgba(225,224,204,0.6)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="7" width="28" height="34" rx="4"/><line x1="10" y1="16" x2="38" y2="16"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="16" y1="31" x2="32" y2="31"/></svg>', '台账还是空的', '粘贴工作清单，点「智能解析」自动分拣成台账')
      : emptyStateHTML('🗂️', '没有符合筛选条件的项目')
  for (const p of list) projListEl.append(projectCard(p, todos, today))
}

function projectCard(p, todos, today) {
  const linked = (p.todoIds || []).map((id) => todos.find((t) => t.id === id)).filter(Boolean)
  const linkedDone = linked.filter((t) => t.done).length
  const linkedOverdue = linked.some((t) => !t.done && t.dueDate && t.dueDate < today)
  const deadlineOverdue = p.deadline && p.deadline < today
  const risky = (p.risks || []).length > 0 || linkedOverdue
  const card = el('div', 'proj-item' + (deadlineOverdue || risky ? ' warn' : ''))

  // 顶行：项目名（可编辑）+ 负责人（可编辑）+ 删除
  const top = el('div', 'proj-item-top')
  const nameBox = el('div', 'proj-item-namebox')
  nameBox.append(makeEditable(p.name, 'proj-item-name', '', (v) => updateProject(p.id, { name: v })))
  top.append(nameBox)
  const ownerTag = makeEditable(p.owner || '', 'proj-owner-tag' + (p.owner ? '' : ' empty'), '＋负责人', (v) =>
    updateProject(p.id, { owner: v || null }),
  )
  top.append(ownerTag)
  const delBtn = el('button', 'proj-del-btn', '删除')
  delBtn.type = 'button'
  let armed = false
  let timer = null
  delBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true
      delBtn.textContent = '确认删除？'
      timer = setTimeout(() => {
        armed = false
        delBtn.textContent = '删除'
      }, 2500)
      return
    }
    clearTimeout(timer)
    deleteProject(p)
  })
  top.append(delBtn)
  card.append(top)

  // 5 阶段时间线：点击节点直接跳到该阶段
  const stageIdx = PROJECT_STAGES.findIndex((s) => s.key === p.stage)
  const progressPct = stageIdx <= 0 ? '0%' : `${(stageIdx / (PROJECT_STAGES.length - 1)) * 100}%`
  const bar = el('div', 'proj-stages')
  bar.style.setProperty('--stage-progress', progressPct)
  // 用内联样式覆盖 ::after 宽度（CSS 变量 + style 兜底）
  const fill = el('div', 'proj-stages-fill')
  fill.style.width = progressPct
  bar.append(fill)
  PROJECT_STAGES.forEach((s, i) => {
    const node = el('button', 'proj-stage-node' + (i < stageIdx ? ' passed' : i === stageIdx ? ' current' : ''))
    node.type = 'button'
    node.title = '点击设为「' + s.label + '」阶段'
    node.append(el('span', 'proj-stage-dot'), el('span', 'proj-stage-label', s.label))
    node.addEventListener('click', () => updateProject(p.id, { stage: s.key }))
    bar.append(node)
  })
  card.append(bar)

  // 元信息行：关键节点 + 风险标签 + 关联待办
  const meta = el('div', 'proj-meta')
  if (p.deadline) {
    const dl = el('span', 'proj-deadline' + (deadlineOverdue ? ' overdue' : ''))
    dl.textContent = deadlineOverdue ? `关键节点 ${p.deadline} · 已逾期 ${daysBetween(p.deadline, today)} 天` : `关键节点 ${p.deadline}`
    meta.append(dl)
  }
  for (const r of p.risks || []) meta.append(el('span', 'proj-risk-tag', r))
  if (linked.length) {
    const count = el('span', 'proj-todo-count' + (linkedOverdue ? ' warn' : ''))
    count.textContent = `待办 ${linkedDone}/${linked.length}`
    meta.append(count)
  }
  card.append(meta)
  return card
}

// 点击文字变输入框，失焦/回车保存
function makeEditable(value, cls, placeholder, onSave) {
  const span = el('span', cls + (value ? '' : ' editable-empty'), value || placeholder)
  span.title = '点击编辑'
  span.addEventListener('click', () => {
    if (span.querySelector('input')) return
    const input = el('input', 'proj-inline-input')
    input.value = value
    span.textContent = ''
    span.append(input)
    input.focus()
    const commit = () => {
      const v = input.value.trim()
      span.textContent = v || placeholder
      span.classList.toggle('editable-empty', !v)
      if (v !== value) onSave(v)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
    })
  })
  return span
}

function updateProject(id, patch) {
  const projects = loadProjects()
  const p = projects.find((x) => x.id === id)
  if (!p) return
  Object.assign(p, patch, { updatedAt: Date.now() })
  saveProjects(projects)
  refreshProjects()
}

function deleteProject(p) {
  const projects = loadProjects().filter((x) => x.id !== p.id)
  saveProjects(projects)
  logActivity('proj-del', `删除项目：${p.name}`)
  refreshProjects()
}

// ===== 筛选区 =====
function renderStageTabs() {
  const projects = loadProjects()
  projStageTabsEl.innerHTML = ''
  const makeTab = (key, label) => {
    const btn = el('button', 'proj-tab' + (projFilterStage === key ? ' active' : ''))
    btn.type = 'button'
    const count = key === 'all' ? projects.length : projects.filter((p) => p.stage === key).length
    btn.append(el('span', '', label), el('span', 'proj-tab-count', String(count)))
    btn.addEventListener('click', () => {
      projFilterStage = key
      renderStageTabs()
      renderProjectList()
    })
    projStageTabsEl.append(btn)
  }
  makeTab('all', '全部')
  for (const s of PROJECT_STAGES) makeTab(s.key, s.label)
}

function renderOwnerFilter() {
  const owners = [...new Set(loadProjects().map((p) => p.owner).filter(Boolean))]
  const cur = projOwnerFilterEl.value
  projOwnerFilterEl.innerHTML = ''
  const allOpt = el('option', '', '全部负责人')
  allOpt.value = 'all'
  projOwnerFilterEl.append(allOpt)
  for (const o of owners) {
    const opt = el('option', '', o)
    opt.value = o
    projOwnerFilterEl.append(opt)
  }
  if ([...projOwnerFilterEl.options].some((o) => o.value === cur)) projOwnerFilterEl.value = cur
}

function refreshProjects() {
  renderStageTabs()
  renderOwnerFilter()
  renderProjectList()
}

// ===== 事件绑定与初始化 =====
projOwnerFilterEl.addEventListener('change', renderProjectList)
projSearchEl.addEventListener('input', renderProjectList)

refreshProjects()

// ============================================================
// 第 5 屏：会议纪要
// ============================================================
const MEETINGS_KEY = 'odb_meetings'

// ===== 第 5 屏 DOM =====
const meetInputTabsEl = $('meet-input-tabs')
const meetFileRowEl = $('meet-file-row')
const meetFileNameEl = $('meet-file-name')
const meetFileClearEl = $('meet-file-clear')
const meetInputEl = $('meet-input')
const meetDocBtnEl = $('meet-doc-btn')
const meetAudioBtnEl = $('meet-audio-btn')
const meetExtractBtnEl = $('meet-extract-btn')
const meetDocFileEl = $('meet-doc-file')
const meetAudioFileEl = $('meet-audio-file')
const meetProgressEl = $('meet-progress')
const meetStatusEl = $('meet-status')
const meetResultEl = $('meet-result')
const meetHistoryListEl = $('meet-history-list')
const meetHistoryEmptyEl = $('meet-history-empty')
const meetHistoryToggleEl = $('meet-history-toggle')

let meetHistoryExpanded = false

let meetMode = 'text'
let meetExtracting = false

ACT_ICONS['meeting-extract'] = '📋'
ACT_ICONS['meeting-sync'] = '🔁'
ACT_ICONS['meeting-del'] = '🗑️'

// ===== 数据读写（保留最近 20 条） =====
function loadMeetings() {
  try {
    return JSON.parse(localStorage.getItem(MEETINGS_KEY)) || []
  } catch {
    return []
  }
}

function saveMeetings(list) {
  localStorage.setItem(MEETINGS_KEY, JSON.stringify(list.slice(0, 20)))
}

// ===== 输入方式切换 =====
function setMeetMode(mode) {
  meetMode = mode
  document.querySelectorAll('.meet-input-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode)
  })
  meetDocBtnEl.hidden = mode !== 'doc'
  meetAudioBtnEl.hidden = mode !== 'audio'
}

meetInputTabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.meet-input-tab')
  if (!tab) return
  const mode = tab.dataset.mode
  setMeetMode(mode)
})

// ===== 文档上传：txt / docx / pdf → 同一个原文 textarea =====
meetDocBtnEl.addEventListener('click', () => meetDocFileEl.click())
meetDocFileEl.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  showMeetProgress(`读取中：${file.name}`)
  try {
    let text = ''
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.txt')) {
      text = await file.text()
    } else if (lower.endsWith('.docx')) {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      text = result.value
    } else if (lower.endsWith('.pdf')) {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
      const pages = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        pages.push(content.items.map((it) => it.str).join(' '))
      }
      text = pages.join('\n')
    } else {
      throw new Error('不支持的文档格式，请用 txt / docx / pdf')
    }
    if (!text.trim()) throw new Error('没从这个文档里提取到文字')
    meetInputEl.value = text.trim()
    meetFileNameEl.textContent = file.name
    meetFileRowEl.hidden = false
    renderMeetStatus('success', `已读取 ${file.name}，可在下方修改后提炼`)
  } catch (err) {
    renderMeetStatus('error', err.message || '文档读取失败')
  } finally {
    hideMeetProgress()
  }
})

meetFileClearEl.addEventListener('click', () => {
  meetFileNameEl.textContent = ''
  meetFileRowEl.hidden = true
})

// ===== 提炼主链路（DeepSeek） =====
async function extractMeeting() {
  const text = meetInputEl.value.trim()
  if (!text) {
    meetInputEl.focus()
    return
  }
  if (meetExtracting) return
  if (DEMO_MODE) {
    demoExtractMeeting(text)
    return
  }
  meetExtracting = true
  meetExtractBtnEl.disabled = true
  meetExtractBtnEl.textContent = '提炼中…'
  renderMeetStatus('loading')
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: meetingPrompt },
          { role: 'user', content: `以下是会议记录原文：\n${text}\n请按铁律提炼。` },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空，请重试')
    const parsed = parseJsonSafe(content)
    const meeting = {
      id: 'm' + Date.now(),
      title: parsed.meetingTitle || '未命名会议',
      date: parsed.meetingDate || todayStr(),
      conclusions: Array.isArray(parsed.conclusions) ? parsed.conclusions.filter(Boolean) : [],
      actionItems: (Array.isArray(parsed.actionItems) ? parsed.actionItems : []).map((a) => ({
        task: a.task || '',
        owner: a.owner || '〔负责人待确认〕',
        deadline: a.deadline || '〔时间待确认〕',
        priority: ['high', 'medium', 'low'].includes(a.priority) ? a.priority : 'low',
      })),
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.filter(Boolean) : [],
      createdAt: Date.now(),
    }
    if (!meeting.conclusions.length && !meeting.actionItems.length) {
      throw new Error('这看起来不像会议记录，AI 没有可提炼的内容')
    }
    const meetings = loadMeetings()
    meetings.unshift(meeting)
    saveMeetings(meetings)
    renderMeetStatus('none')
    renderMeetingResult(meeting)
    logActivity('meeting-extract', `提炼纪要：${meeting.title}`)
    renderOnboardingProgress()
    renderMeetHistory()
  } catch (err) {
    renderMeetStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    meetExtracting = false
    meetExtractBtnEl.disabled = false
    meetExtractBtnEl.textContent = '提炼纪要'
  }
}

function renderMeetStatus(kind, msg = '') {
  meetStatusEl.innerHTML = ''
  if (kind === 'none') return
  const card = el(
    'div',
    'meet-status' +
      (kind === 'error' || kind === 'key' ? ' meet-status-error' : kind === 'success' ? ' meet-status-success' : ''),
  )
  if (kind === 'loading') {
    card.append(el('div', 'meet-spinner'), el('p', 'meet-status-text', '正在提炼，约需 10~20 秒…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'meet-status-icon', '🔑'),
      el('h3', 'meet-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'meet-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'error') {
    card.append(el('div', 'meet-status-icon', '⚠️'), el('h3', 'meet-status-title', '提炼失败'), el('p', 'meet-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', extractMeeting)
    card.append(retry)
  } else if (kind === 'info') {
    card.append(el('div', 'meet-status-icon', 'ℹ️'), el('p', 'meet-status-text', msg))
  } else if (kind === 'success') {
    card.append(el('div', 'meet-status-icon', '✅'), el('p', 'meet-status-text', msg))
  }
  meetStatusEl.append(card)
}

function showMeetProgress(msg) {
  meetProgressEl.textContent = msg
  meetProgressEl.hidden = false
}

function hideMeetProgress() {
  meetProgressEl.hidden = true
}

// ===== 结果渲染（可指定目标容器，供历史展开复用） =====
function renderMeetingResult(m, target = meetResultEl) {
  target.innerHTML = ''
  const wrap = el('div', 'meet-result-wrap')
  const head = el('div', 'meet-result-head')
  const titleBox = el('div')
  titleBox.append(el('h3', 'meet-result-title', m.title))
  titleBox.append(el('div', 'meet-result-date', '📅 ' + (m.date || '')))
  const actions = el('div', 'meet-result-actions')
  const copyBtn = el('button', 'meet-copy-btn', '一键复制成可发群纯文本')
  copyBtn.type = 'button'
  copyBtn.addEventListener('click', () => copyMeetingText(m))
  const syncBtn = el('button', 'meet-sync-btn', '待办同步到工作台')
  syncBtn.type = 'button'
  syncBtn.addEventListener('click', () => syncMeetingTodos(m))
  // P1：多格式导出（邮件 / 飞书 / Markdown）
  const emailBtn = el('button', 'meet-copy-btn meet-more-btn', '邮件版')
  emailBtn.type = 'button'
  emailBtn.title = '复制为邮件正文（含主题、称呼、落款）'
  emailBtn.addEventListener('click', () => copyTextWithToast(buildMeetingEmail(m), '已复制邮件版，可直接粘贴到邮箱正文'))
  const feishuBtn = el('button', 'meet-copy-btn meet-more-btn', '飞书版')
  feishuBtn.type = 'button'
  feishuBtn.title = '复制为飞书文档格式（Markdown 勾选框，粘贴后回车即可转换）'
  feishuBtn.addEventListener('click', () => copyTextWithToast(buildMeetingFeishu(m), '已复制飞书版，粘贴到飞书文档后按回车可转换格式'))
  const mdBtn = el('button', 'meet-copy-btn meet-more-btn', 'Markdown')
  mdBtn.type = 'button'
  mdBtn.title = '复制为标准 Markdown'
  mdBtn.addEventListener('click', () => copyTextWithToast(buildMeetingMarkdown(m), '已复制 Markdown 版'))
  actions.append(copyBtn, emailBtn, feishuBtn, mdBtn, syncBtn)
  head.append(titleBox, actions)
  wrap.append(head)

  if (m.memoryNote) wrap.append(el('div', 'meet-memory-note', m.memoryNote))
  prependHTML(wrap, aiProvHTML(DEMO_MODE ? 'demo' : 'real-ai', m.createdAt))

  // 一、结论
  const cSec = el('section', 'meet-section')
  cSec.append(el('h4', 'meet-sec-title', '一、结论'))
  const cUl = el('ul', 'meet-list')
  for (const c of m.conclusions) cUl.append(el('li', '', c))
  cSec.append(cUl)
  wrap.append(cSec)

  // 二、待办（按优先级排序，high 在前）
  const aSec = el('section', 'meet-section')
  aSec.append(el('h4', 'meet-sec-title', '二、待办'))
  const order = { high: 0, medium: 1, low: 2 }
  const sorted = [...m.actionItems].sort((a, b) => order[a.priority] - order[b.priority])
  const aUl = el('ul', 'meet-list meet-ai-list')
  for (const a of sorted) {
    const li = el('li', 'meet-ai-item')
    if (a.priority === 'high') li.append(el('span', 'meet-ai-prio', '🔴'))
    li.append(el('span', 'meet-ai-task', a.task))
    const owner = el('span', 'meet-ai-owner' + (a.owner === '〔负责人待确认〕' ? ' pending' : ''), a.owner)
    const deadline = el('span', 'meet-ai-deadline' + (a.deadline === '〔时间待确认〕' ? ' pending' : ''), a.deadline)
    li.append(owner, deadline)
    aUl.append(li)
  }
  aSec.append(aUl)
  wrap.append(aSec)

  // 三、待定问题（空则整节省略）
  if (m.openQuestions && m.openQuestions.length) {
    const qSec = el('section', 'meet-section')
    qSec.append(el('h4', 'meet-sec-title', '三、待定问题'))
    const qUl = el('ul', 'meet-list')
    for (const q of m.openQuestions) qUl.append(el('li', 'meet-open-q', '❓ ' + q))
    qSec.append(qUl)
    wrap.append(qSec)
  }
  target.append(wrap)
}

// ===== 一键复制（严格按 prompt-会议纪要.md 第三节模板） =====
function buildCopyText(m) {
  const order = { high: 0, medium: 1, low: 2 }
  const sorted = [...m.actionItems].sort((a, b) => order[a.priority] - order[b.priority])
  const lines = []
  lines.push(`【${m.title} 会议纪要】`)
  lines.push(`📅 ${m.date || todayStr()}`)
  lines.push('')
  lines.push('一、结论')
  m.conclusions.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  lines.push('')
  lines.push('二、待办')
  for (const a of sorted) {
    lines.push(`${a.priority === 'high' ? '🔴 ' : ''}□ ${a.task}｜${a.owner}｜${a.deadline}`)
  }
  if (m.openQuestions && m.openQuestions.length) {
    lines.push('')
    lines.push('三、待定问题')
    for (const q of m.openQuestions) lines.push(`❓ ${q}`)
  }
  lines.push('')
  lines.push('—— 由「登陆岛」整理')
  return lines.join('\n')
}

async function copyMeetingText(m) {
  const text = buildCopyText(m)
  await copyTextWithToast(text, '已复制，可粘贴到群里')
}

// ===== P1：通用复制（剪贴板 + execCommand 兜底） =====
async function copyTextWithToast(text, msg) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(msg)
  } catch {
    // 兜底：execCommand('copy')
    const ta = el('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    showToast(ok ? msg : '复制失败，请手动选择文本复制')
  }
}

// ===== P1：纪要多格式构建 =====
function sortActionItems(m) {
  const order = { high: 0, medium: 1, low: 2 }
  return [...m.actionItems].sort((a, b) => order[a.priority] - order[b.priority])
}

// 邮件版：主题 + 称呼 + 正文 + 落款
function buildMeetingEmail(m) {
  const sorted = sortActionItems(m)
  const lines = []
  lines.push(`主题：【会议纪要】${m.title}（${m.date || todayStr()}）`)
  lines.push('')
  lines.push('各位同事：')
  lines.push('')
  lines.push(`以下是 ${m.date || todayStr()}「${m.title}」的会议纪要，请查收。`)
  lines.push('')
  lines.push('一、结论')
  m.conclusions.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  lines.push('')
  lines.push('二、待办（请相关负责人按期推进）')
  for (const a of sorted) {
    lines.push(`□ ${a.priority === 'high' ? '【紧急】' : ''}${a.task}｜负责人：${a.owner}｜截止：${a.deadline}`)
  }
  if (m.openQuestions && m.openQuestions.length) {
    lines.push('')
    lines.push('三、待定问题')
    for (const q of m.openQuestions) lines.push(`· ${q}`)
  }
  lines.push('')
  lines.push('如有遗漏或出入，欢迎回复补充。')
  lines.push('')
  lines.push('—— 由「登陆岛」整理')
  return lines.join('\n')
}

// 飞书版：Markdown 勾选框语法，粘贴到飞书文档后回车即转格式
function buildMeetingFeishu(m) {
  const sorted = sortActionItems(m)
  const lines = []
  lines.push(`**${m.title} 会议纪要**`)
  lines.push(`📅 ${m.date || todayStr()}`)
  lines.push('')
  lines.push('**一、结论**')
  m.conclusions.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  lines.push('')
  lines.push('**二、待办**')
  for (const a of sorted) {
    lines.push(`- [ ] ${a.priority === 'high' ? '🔴 ' : ''}${a.task}｜${a.owner}｜${a.deadline}`)
  }
  if (m.openQuestions && m.openQuestions.length) {
    lines.push('')
    lines.push('**三、待定问题**')
    for (const q of m.openQuestions) lines.push(`- ❓ ${q}`)
  }
  lines.push('')
  lines.push('_由「登陆岛」整理_')
  return lines.join('\n')
}

// Markdown 版：标准语法，适配任意文档工具
function buildMeetingMarkdown(m) {
  const sorted = sortActionItems(m)
  const lines = []
  lines.push(`# ${m.title} 会议纪要`)
  lines.push('')
  lines.push(`> 📅 ${m.date || todayStr()}`)
  lines.push('')
  lines.push('## 一、结论')
  m.conclusions.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  lines.push('')
  lines.push('## 二、待办')
  for (const a of sorted) {
    lines.push(`- [ ] ${a.priority === 'high' ? '🔴 ' : ''}${a.task}｜${a.owner}｜${a.deadline}`)
  }
  if (m.openQuestions && m.openQuestions.length) {
    lines.push('')
    lines.push('## 三、待定问题')
    for (const q of m.openQuestions) lines.push(`- ❓ ${q}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('*由「登陆岛」整理*')
  return lines.join('\n')
}

// ===== 待办同步到工作台（同标题未完成跳过） =====
function syncMeetingTodos(m) {
  const todos = loadTodos()
  const now = Date.now()
  let added = 0
  let skipped = 0
  for (const a of m.actionItems) {
    const task = (a.task || '').trim()
    if (!task) continue
    if (todos.some((t) => t.title === task && !t.done)) {
      skipped++
      continue
    }
    let due = null
    if (a.deadline && /^\d{4}-\d{2}-\d{2}$/.test(a.deadline) && !isNaN(new Date(a.deadline).getTime())) {
      due = a.deadline
    }
    todos.unshift({
      id: 't' + now + '-' + added,
      title: task,
      dueDate: due,
      priority: a.priority === 'high' ? '高' : a.priority === 'medium' ? '中' : '低',
      note: `来自纪要：${m.title}`,
      done: false,
      createdAt: now,
      doneAt: null,
    })
    added++
  }
  if (!added && !skipped) {
    showToast('没有可同步的待办')
    return
  }
  saveTodos(todos)
  logActivity('meeting-sync', `从纪要同步 ${added} 条待办`)
  showToast(`已同步 ${added} 条，跳过重复 ${skipped} 条`)
  refreshDashboard()
}

// ===== 最近纪要（默认折叠显示最近 2 条，「查看历史」展开全部） =====
function renderMeetHistory() {
  const list = loadMeetings()
  const shown = meetHistoryExpanded ? list : list.slice(0, 2)
  meetHistoryListEl.innerHTML = ''
  meetHistoryEmptyEl.hidden = list.length > 0
  meetHistoryToggleEl.hidden = list.length <= 2
  meetHistoryToggleEl.textContent = meetHistoryExpanded ? '收起' : `查看历史（共 ${list.length} 条）`
  for (const m of shown) {
    const li = el('li', 'meet-history-item')
    const row = el('div', 'meet-history-row')
    const info = el('div', 'meet-history-info')
    info.append(
      el('div', 'meet-history-title', m.title),
      el('div', 'meet-history-meta', `${m.date || ''} · ${(m.actionItems || []).length} 条待办`),
    )
    const delBtn = el('button', 'meet-history-del', '删除')
    delBtn.type = 'button'
    let armed = false
    let timer = null
    delBtn.addEventListener('click', () => {
      if (!armed) {
        armed = true
        delBtn.textContent = '确认删除？'
        timer = setTimeout(() => {
          armed = false
          delBtn.textContent = '删除'
        }, 2500)
        return
      }
      clearTimeout(timer)
      const next = loadMeetings().filter((x) => x.id !== m.id)
      saveMeetings(next)
      logActivity('meeting-del', `删除纪要：${m.title}`)
      renderMeetHistory()
    })
    row.append(info, delBtn)
    row.addEventListener('click', (e) => {
      if (e.target === delBtn) return
      const detail = li.querySelector('.meet-history-detail')
      const open = li.classList.toggle('open')
      detail.classList.toggle('open', open)
      if (open && !detail.firstChild) {
        renderMeetingResult(m, detail)
      }
    })
    const detail = el('div', 'meet-history-detail')
    li.append(row, detail)
    meetHistoryListEl.append(li)
  }
}

// ===== Toast =====
let toastTimer = null
function showToast(msg) {
  let t = document.querySelector('.meet-toast')
  if (!t) {
    t = el('div', 'meet-toast')
    document.body.append(t)
  }
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600)
}

// ===== 任务 B：录音转写（本地解码 + DashScope WebSocket 推流） =====
meetAudioBtnEl.addEventListener('click', () => meetAudioFileEl.click())
meetAudioFileEl.addEventListener('change', (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  handleAudioFile(file)
})

async function handleAudioFile(file) {
  if (!/\.(mp3|wav|m4a)$/i.test(file.name)) {
    renderMeetStatus('error', '只支持 mp3 / wav / m4a 录音文件')
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    renderMeetStatus('error', '录音文件不能超过 50MB')
    return
  }
  const asrKey = import.meta.env.VITE_DASHSCOPE_API_KEY || ''
  if (!asrKey) {
    renderMeetStatus('error', '还没配置 DashScope API Key（.env 里的 VITE_DASHSCOPE_API_KEY）')
    return
  }
  showMeetProgress('上传中…')
  try {
    const buf = await file.arrayBuffer()
    showMeetProgress('解码中…')
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    let audioBuf
    try {
      audioBuf = await ctx.decodeAudioData(buf.slice(0))
    } catch {
      throw new Error('音频解码失败，请换一个文件试试')
    }
    ctx.close()
    const duration = audioBuf.duration
    showMeetProgress(`转写中（已 0 秒）`)
    const pcm = resampleToPCM16(audioBuf, 16000)
    const text = await dashscopeTranscribe(pcm, (secs) => {
      showMeetProgress(
        duration > 30
          ? `录音约 ${Math.round(duration / 60)} 分钟，预计耗时约 ${Math.max(10, Math.round(duration * 1.2))} 秒 · 转写中（已 ${secs} 秒）`
          : `转写中（已 ${secs} 秒）`,
      )
    })
    if (!text.trim()) throw new Error('没识别出文字，请确认录音里有清晰的人声')
    meetInputEl.value = text.trim()
    meetFileNameEl.textContent = `${file.name}（转写）`
    meetFileRowEl.hidden = false
    renderMeetStatus('success', '转写完成，可修改后点「提炼纪要」')
  } catch (err) {
    renderMeetStatus('error', err.message || '转写失败')
  } finally {
    hideMeetProgress()
  }
}

// 多声道混合 + 线性重采样为 16kHz 单声道 PCM16
function resampleToPCM16(audioBuf, targetRate) {
  const srcRate = audioBuf.sampleRate
  const channels = audioBuf.numberOfChannels
  const outLen = Math.round((audioBuf.length * targetRate) / srcRate)
  const out = new Int16Array(outLen)
  const ratio = srcRate / targetRate
  for (let i = 0; i < outLen; i++) {
    const srcIdx = Math.floor(i * ratio)
    let sum = 0
    for (let c = 0; c < channels; c++) sum += audioBuf.getChannelData(c)[srcIdx]
    const v = Math.max(-1, Math.min(1, sum / channels))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out.buffer
}

// DashScope paraformer-realtime-v2：WebSocket 分片推流识别
// 鉴权：浏览器 WebSocket 无法携带 Header，实测 ?api_key= query 鉴权可用
// 协议：task_group/task/model 放 payload；服务端事件在 header.event；task-started 后才可推流
function dashscopeTranscribe(pcmBuffer, onTick) {
  return new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_DASHSCOPE_API_KEY || ''
    const wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=${encodeURIComponent(key)}`
    const ws = new WebSocket(wsUrl)
    const taskId = 'asr-' + Date.now()
    let fullText = ''
    let partial = ''
    let settled = false
    const startTime = Date.now()
    const ticker = setInterval(() => {
      if (onTick) onTick(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    const watchdog = setTimeout(() => {
      if (settled) return
      settled = true
      clearInterval(ticker)
      try {
        ws.close()
      } catch {}
      reject(new Error('转写超时，请重试或换更短的录音'))
    }, 300000)

    const settle = (fn, val) => {
      if (settled) return
      settled = true
      clearInterval(ticker)
      clearTimeout(watchdog)
      fn(val)
    }

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            model: 'paraformer-realtime-v2',
            function: 'recognition',
            parameters: {
              format: 'pcm',
              sample_rate: 16000,
              semantic_punctuation: true,
              disfluency_removal_enabled: false,
              incremental_output: true,
              max_sentence_silence: 800,
              language_hints: ['zh'],
            },
            input: {},
          },
        }),
      )
    }

    // 收到 task-started 后开始按 100ms 一帧（16kHz 16bit 单声道 = 3200 字节）推流
    const pushNext = (off) => {
      if (settled) return
      if (off >= pcmBuffer.byteLength) {
        ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
        return
      }
      const end = Math.min(off + 3200, pcmBuffer.byteLength)
      ws.send(pcmBuffer.slice(off, end))
      setTimeout(() => pushNext(end), 90)
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const event = msg.header?.event || ''
      if (event === 'task-failed') {
        const code = msg.header?.error_code || ''
        const reason = msg.header?.error_message || code || '未知错误'
        settle(reject, new Error(`转写服务报错：${reason}`))
        return
      }
      if (event === 'task-finished') {
        if (partial) fullText += partial
        settle(() => {
          try {
            ws.close()
          } catch {}
          resolve(fullText.trim())
        })
        return
      }
      if (event === 'task-started') {
        pushNext(0)
        return
      }
      if (event === 'result-generated') {
        const out = msg.payload?.output
        if (out?.sentence) {
          const t = out.sentence.text || ''
          if (out.sentence.sentence_end === true) {
            fullText += t
            partial = ''
          } else {
            partial = t
          }
        } else if (out?.text) {
          partial = out.text
        }
      }
    }

    ws.onerror = () => settle(reject, new Error('转写服务连接失败，请稍后重试'))
    ws.onclose = () => {
      if (!settled) settle(reject, new Error('转写连接中断，请重试'))
    }
  })
}

// ===== 事件绑定与初始化 =====
meetExtractBtnEl.addEventListener('click', extractMeeting)
meetHistoryToggleEl.addEventListener('click', () => {
  meetHistoryExpanded = !meetHistoryExpanded
  renderMeetHistory()
})
renderMeetHistory()

// ============================================================
// 第 6 屏：周报与向上汇报
// ============================================================
const REPORTS_KEY = 'odb_reports'

// ===== 第 6 屏 DOM =====
const repTabsEl = $('rep-tabs')
const repPanelWeeklyEl = $('rep-panel-weekly')
const repPanelUpwardEl = $('rep-panel-upward')
const repEmptyHintEl = $('rep-empty-hint')
const repGenerateBtn = $('rep-generate-btn')
const repStatusEl = $('rep-status')
const repEditorEl = $('rep-editor')
const repEditorCloseBtn = $('rep-editor-close')
const repEditorMetaEl = $('rep-editor-meta')
const repCopyBtn = $('rep-copy-btn')
const repCopyWechatBtn = $('rep-copy-wechat')
const repCopyEmailBtn = $('rep-copy-email')
const repHistoryListEl = $('rep-history-list')
const repHistoryEmptyEl = $('rep-history-empty')
const repHistoryToggleEl = $('rep-history-toggle')

let repHistoryExpanded = false
const repUpwardBtn = $('rep-upward-btn')
const repUpwardStatusEl = $('rep-upward-status')
const repUpwardEditorEl = $('rep-upward-editor')
const repUpwardCopyBtn = $('rep-upward-copy')
const repUpwardWechatBtn = $('rep-upward-wechat')
const repUpwardEmailBtn = $('rep-upward-email')

// P1：周报三种复制按钮的显隐统一控制（有内容才出现）
function setWeeklyCopyVisible(visible) {
  repCopyBtn.hidden = !visible
  repCopyWechatBtn.hidden = !visible
  repCopyEmailBtn.hidden = !visible
}

// 根据编辑器是否有内容显隐关闭按钮
function updateRepEditorClose() {
  if (repEditorCloseBtn) {
    repEditorCloseBtn.hidden = !repEditorEl.value.trim()
  }
}

function setUpwardCopyVisible(visible) {
  repUpwardCopyBtn.hidden = !visible
  repUpwardWechatBtn.hidden = !visible
  repUpwardEmailBtn.hidden = !visible
}

let repGenerating = false
let repUpwardGenerating = false
let repOverwriteArmed = false

ACT_ICONS['report-weekly'] = '📊'
ACT_ICONS['report-upward'] = '📤'

function loadReports() {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY)) || []
  } catch {
    return []
  }
}

function saveReports(list) {
  // 按 weekStart 倒序保留 8 条
  const sorted = [...list].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 8)
  localStorage.setItem(REPORTS_KEY, JSON.stringify(sorted))
}

// ===== 本周数据快照（前端计算，AI 只负责组织成文，禁止编造） =====
function buildWeeklySnapshot() {
  const todos = loadTodos()
  const projects = loadProjects()
  const meetings = loadMeetings()
  const monday = mondayStart()
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const weekStartStr = fmt(monday)
  const weekStartMs = monday.getTime()
  const weekEndMs = weekStartMs + 7 * 86400000
  const nextMondayStr = fmt(new Date(weekStartMs + 7 * 86400000))
  const nextSundayStr = fmt(new Date(weekStartMs + 13 * 86400000))
  const today = todayStr()

  // 本周完成度（算法与第 2 屏环形一致：分母=本周一以来创建的待办）
  const weekCreated = todos.filter((t) => t.createdAt >= weekStartMs)
  const weekDone = weekCreated.filter((t) => t.done)
  const completion = weekCreated.length ? Math.round((weekDone.length / weekCreated.length) * 100) : 0

  // 已完成：doneAt 在本周，附关联项目名
  const completed = todos
    .filter((t) => t.done && t.doneAt && t.doneAt >= weekStartMs)
    .map((t) => {
      const proj = projects.find((p) => (p.todoIds || []).includes(t.id))
      return { title: t.title, doneAt: t.doneAt, project: proj ? proj.name : undefined }
    })

  // 延期：未完成且 dueDate < 今天（days 用 Date 差值，跨月安全）
  const overdue = todos
    .filter((t) => !t.done && t.dueDate && t.dueDate < today)
    .map((t) => ({ title: t.title, dueDate: t.dueDate, days: daysBetween(t.dueDate, today) }))

  // 风险：risks 非空的项目
  const risks = projects
    .filter((p) => p.risks && p.risks.length)
    .map((p) => ({ project: p.name, risks: p.risks }))

  // 下周计划：未完成且 dueDate 在下周一~下周日
  const nextWeek = todos
    .filter((t) => !t.done && t.dueDate && t.dueDate >= nextMondayStr && t.dueDate <= nextSundayStr)
    .map((t) => ({ title: t.title, dueDate: t.dueDate, priority: t.priority }))

  // 本周创建的纪要
  const meetingsThisWeek = meetings
    .filter((m) => m.createdAt >= weekStartMs && m.createdAt < weekEndMs)
    .map((m) => ({
      title: m.title,
      date: m.date,
      actionItems: (m.actionItems || []).map((a) => ({ task: a.task, owner: a.owner, deadline: a.deadline })),
    }))

  // 本周更新过的项目
  const projectsThisWeek = projects
    .filter((p) => p.updatedAt >= weekStartMs && p.updatedAt < weekEndMs)
    .map((p) => ({
      name: p.name,
      stage: (PROJECT_STAGES.find((s) => s.key === p.stage) || {}).label || p.stage,
      deadline: p.deadline,
    }))

  return {
    weekStart: weekStartStr,
    today,
    completion,
    completed,
    overdue,
    risks,
    nextWeek,
    meetings: meetingsThisWeek,
    projects: projectsThisWeek,
  }
}

// ===== 标签切换 =====
function setRepTab(tab) {
  document.querySelectorAll('.rep-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  repPanelWeeklyEl.hidden = tab !== 'weekly'
  repPanelUpwardEl.hidden = tab !== 'upward'
  if (tab === 'weekly') refreshRepStats()
}

repTabsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.rep-tab')
  if (b) setRepTab(b.dataset.tab)
})

// ===== 统计条（复用共享 stats 组件） =====
function refreshRepStats() {
  const snap = buildWeeklySnapshot()
  const hasData = loadTodos().length + loadProjects().length + loadMeetings().length > 0
  const ringRatio = hasData ? snap.completion / 100 : 0
  const stats = [
    { key: 'week', label: '本周完成度', value: hasData ? `${snap.completion}%` : '—', ring: true, ringRatio },
    { key: 'done', label: '完成', value: snap.completed.length },
    { key: 'overdue', label: '延期', value: snap.overdue.length },
    { key: 'risks', label: '风险', value: snap.risks.length },
  ]
  renderStatsGrid($('rep-stats'), 'rep', stats)
  repEmptyHintEl.hidden = hasData
  repEditorMetaEl.textContent = `本周 ${snap.weekStart} ~ ${snap.today}`
}

function updateRepGenerateBtn() {
  const snap = buildWeeklySnapshot()
  const existing = loadReports().find((r) => r.weekStart === snap.weekStart)
  repOverwriteArmed = false
  repGenerateBtn.textContent = existing ? '重新生成' : '生成本周周报'
}

// 去掉 Markdown 代码围栏（纯文本输出的兜底清洗）
function stripCodeFence(text) {
  return text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '')
}

// ===== 生成周报（纯文本输出，不用 json_object） =====
repGenerateBtn.addEventListener('click', () => {
  const snap = buildWeeklySnapshot()
  const existing = loadReports().find((r) => r.weekStart === snap.weekStart)
  if (existing && !repOverwriteArmed) {
    repOverwriteArmed = true
    repGenerateBtn.textContent = '确认覆盖本周周报？'
    setTimeout(updateRepGenerateBtn, 3000)
    return
  }
  doGenerateWeekly()
})

async function doGenerateWeekly() {
  if (repGenerating) return
  if (DEMO_MODE) {
    demoGenerateWeekly()
    return
  }
  repGenerating = true
  repGenerateBtn.disabled = true
  repGenerateBtn.textContent = '生成中…'
  renderRepStatus('loading')
  try {
    const snapshot = buildWeeklySnapshot()
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: weeklyPrompt },
          { role: 'user', content: `${profileContextText()}\n本周数据快照：\n${JSON.stringify(snapshot)}\n请写周报。` },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = stripCodeFence((data.choices?.[0]?.message?.content || '').trim())
    if (!content) throw new Error('AI 返回内容为空，请重试')
    repEditorEl.value = content
    const reports = loadReports()
    const existing = reports.find((r) => r.weekStart === snapshot.weekStart)
    if (existing) {
      existing.weekly = content
      existing.createdAt = Date.now()
    } else {
      reports.unshift({ id: 'r' + Date.now(), weekStart: snapshot.weekStart, weekly: content, upward: null, createdAt: Date.now() })
    }
    saveReports(reports)
    repCopyBtn.hidden = false
    repCopyWechatBtn.hidden = false
    repCopyEmailBtn.hidden = false
    updateRepEditorClose()
    renderRepHistory()
    refreshRepStats()
    updateRepGenerateBtn()
    const repProvEl = document.getElementById('rep-prov')
    if (repProvEl) repProvEl.innerHTML = aiProvHTML('real-ai')
    logActivity('report-weekly', `生成周报：${snapshot.weekStart} 起的一周`)
    updateProfile({ reportCount: (loadProfile().reportCount || 0) + 1 })
    renderOnboardingProgress()
  } catch (err) {
    renderRepStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    repGenerating = false
    repGenerateBtn.disabled = false
    updateRepGenerateBtn()
  }
}

function renderRepStatus(kind, msg = '') {
  repStatusEl.innerHTML = ''
  if (kind === 'none') return
  const card = el(
    'div',
    'rep-status' +
      (kind === 'error' || kind === 'key' ? ' rep-status-error' : kind === 'success' ? ' rep-status-success' : ''),
  )
  if (kind === 'loading') {
    card.append(el('div', 'rep-spinner'), el('p', 'rep-status-text', '正在生成，约需 10~20 秒…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'rep-status-icon', '🔑'),
      el('h3', 'rep-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'rep-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'error') {
    card.append(el('div', 'rep-status-icon', '⚠️'), el('h3', 'rep-status-title', '生成失败'), el('p', 'rep-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', doGenerateWeekly)
    card.append(retry)
  } else if (kind === 'success') {
    card.append(el('div', 'rep-status-icon', '✅'), el('p', 'rep-status-text', msg))
  }
  repStatusEl.append(card)
}

// ===== 生成向上汇报（基于标签一的当前周报内容） =====
repUpwardBtn.addEventListener('click', doGenerateUpward)

async function doGenerateUpward() {
  const weeklyText = repEditorEl.value.trim()
  if (!weeklyText) {
    renderRepUpwardStatus('info', '先在「生成本周周报」标签生成周报')
    return
  }
  if (repUpwardGenerating) return
  if (DEMO_MODE) {
    demoGenerateUpward(weeklyText)
    return
  }
  repUpwardGenerating = true
  repUpwardBtn.disabled = true
  repUpwardBtn.textContent = '生成中…'
  renderRepUpwardStatus('loading')
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: upwardPrompt },
          { role: 'user', content: `${profileContextText()}\n我的周报原文：\n${weeklyText}\n请改写。` },
        ],
        temperature: 0.5,
        max_tokens: 600,
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = stripCodeFence((data.choices?.[0]?.message?.content || '').trim())
    if (!content) throw new Error('AI 返回内容为空，请重试')
    repUpwardEditorEl.value = content
    repUpwardCopyBtn.hidden = false
    repUpwardWechatBtn.hidden = false
    repUpwardEmailBtn.hidden = false
    // 回填到同一周的记录
    const snap = buildWeeklySnapshot()
    const reports = loadReports()
    const r = reports.find((x) => x.weekStart === snap.weekStart)
    if (r) {
      r.upward = content
      saveReports(reports)
      renderRepHistory()
    }
    renderRepUpwardStatus('success', '向上汇报已生成，可直接编辑后复制')
    const upProvEl = document.getElementById('rep-upward-prov')
    if (upProvEl) upProvEl.innerHTML = aiProvHTML('real-ai')
    logActivity('report-upward', '生成向上汇报')
    renderOnboardingProgress()
  } catch (err) {
    renderRepUpwardStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    repUpwardGenerating = false
    repUpwardBtn.disabled = false
    repUpwardBtn.textContent = '生成向上汇报'
  }
}

function renderRepUpwardStatus(kind, msg = '') {
  repUpwardStatusEl.innerHTML = ''
  if (kind === 'none') return
  const card = el(
    'div',
    'rep-status' +
      (kind === 'error' || kind === 'key' ? ' rep-status-error' : kind === 'success' ? ' rep-status-success' : ''),
  )
  if (kind === 'loading') {
    card.append(el('div', 'rep-spinner'), el('p', 'rep-status-text', '正在改写，约需 10~15 秒…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'rep-status-icon', '🔑'),
      el('h3', 'rep-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'rep-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'error') {
    card.append(el('div', 'rep-status-icon', '⚠️'), el('h3', 'rep-status-title', '生成失败'), el('p', 'rep-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', doGenerateUpward)
    card.append(retry)
  } else if (kind === 'info') {
    card.append(el('div', 'rep-status-icon', 'ℹ️'), el('p', 'rep-status-text', msg))
  } else if (kind === 'success') {
    card.append(el('div', 'rep-status-icon', '✅'), el('p', 'rep-status-text', msg))
  }
  repUpwardStatusEl.append(card)
}

// ===== 复制 =====
async function copyRepText(text) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制')
  } catch {
    const ta = el('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    showToast(ok ? '已复制' : '复制失败，请手动选择文本复制')
  }
}

// ===== P1：周报格式转换（微信消息 / 邮件正文） =====
// 微信消息版：去掉 Markdown 符号、紧凑排版，适合直接发群里
function buildWeChatReport(text) {
  return text
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^#{1,6}\s*/, '') // 标题符号
        .replace(/\*\*/g, '') // 加粗
        .replace(/^>\s?/, '') // 引用
        .replace(/^[-*]\s+/, '· ')
        .replace(/`/g, ''),
    )
    .filter((l) => l !== '---')
    .join('\n')
}

// 邮件版：主题 + 称呼 + 正文（去 Markdown 符号）+ 落款
function buildEmailReport(subject, text) {
  const plain = text.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/^>\s?/gm, '').replace(/`/g, '')
  const lines = []
  lines.push(`主题：${subject}`)
  lines.push('')
  lines.push('领导好：')
  lines.push('')
  lines.push(plain.trim())
  lines.push('')
  lines.push('以上是本周工作情况，如有问题欢迎随时指出。')
  return lines.join('\n')
}

repCopyWechatBtn.addEventListener('click', () =>
  copyTextWithToast(buildWeChatReport(repEditorEl.value), '已复制微信版，可直接粘贴到聊天框'),
)
repCopyEmailBtn.addEventListener('click', () =>
  copyTextWithToast(
    buildEmailReport(`${repEditorMetaEl.textContent || '本周'}周报`, repEditorEl.value),
    '已复制邮件版（含主题行），可直接粘贴到邮箱',
  ),
)
repUpwardWechatBtn.addEventListener('click', () =>
  copyTextWithToast(buildWeChatReport(repUpwardEditorEl.value), '已复制微信版，可直接粘贴到聊天框'),
)
repUpwardEmailBtn.addEventListener('click', () =>
  copyTextWithToast(buildEmailReport('本周工作汇报', repUpwardEditorEl.value), '已复制邮件版（含主题行），可直接粘贴到邮箱'),
)

repCopyBtn.addEventListener('click', () => copyRepText(repEditorEl.value))
repUpwardCopyBtn.addEventListener('click', () => copyRepText(repUpwardEditorEl.value))

// 关闭按钮：清空周报编辑器并隐藏相关操作
if (repEditorCloseBtn) {
  repEditorCloseBtn.addEventListener('click', () => {
    repEditorEl.value = ''
    setWeeklyCopyVisible(false)
    renderRepStatus('none')
    const repProvEl = document.getElementById('rep-prov')
    if (repProvEl) repProvEl.innerHTML = ''
    updateRepEditorClose()
    updateRepGenerateBtn()
  })
}

// 手动输入时也同步关闭按钮显隐
repEditorEl.addEventListener('input', updateRepEditorClose)

$('rep-goto-workbench').addEventListener('click', () => {
  window.location.hash = 'screen-2'
})

// ===== 历史周报（默认折叠显示最近 2 条，「查看历史」展开全部） =====
function renderRepHistory() {
  const list = loadReports()
  const shown = repHistoryExpanded ? list : list.slice(0, 2)
  repHistoryListEl.innerHTML = ''
  repHistoryEmptyEl.hidden = list.length > 0
  repHistoryToggleEl.hidden = list.length <= 2
  repHistoryToggleEl.textContent = repHistoryExpanded ? '收起' : `查看历史（共 ${list.length} 条）`
  for (const r of shown) {
    const li = el('li', 'rep-history-item')
    const btn = el('button', 'rep-history-row')
    btn.type = 'button'
    btn.append(
      el('span', 'rep-history-week', `${r.weekStart} 起的一周`),
      el('span', 'rep-history-flags', (r.weekly ? '周报' : '') + (r.upward ? ' + 汇报' : '')),
    )
    btn.addEventListener('click', () => {
      repEditorEl.value = r.weekly || ''
      repUpwardEditorEl.value = r.upward || ''
      repEditorMetaEl.textContent = `${r.weekStart} 起的一周`
      setWeeklyCopyVisible(!!r.weekly)
      setUpwardCopyVisible(!!r.upward)
      updateRepEditorClose()
      renderRepStatus('none')
      renderRepUpwardStatus('none')
      setRepTab('weekly')
      updateRepGenerateBtn()
    })
    li.append(btn)
    repHistoryListEl.append(li)
  }
}

// ===== 初始化 =====
repHistoryToggleEl.addEventListener('click', () => {
  repHistoryExpanded = !repHistoryExpanded
  renderRepHistory()
})
renderRepHistory()
refreshRepStats()
updateRepGenerateBtn()

// 切到周报屏时刷新数据，保证工作台最新数据同步到周报
// 并把已保存的周报/向上汇报回填进编辑器（演示模式预置的示例、以及用户历史生成结果都能直接看到，无需重跑）
function loadSavedReportIntoEditor() {
  if (!repEditorEl) return
  const reports = loadReports()
  const r = reports.find((x) => x.weekly) || reports[0]
  if (!r) return
  if (repEditorEl.value.trim() === '') {
    repEditorEl.value = r.weekly || ''
    updateRepEditorClose()
  }
  if (repUpwardEditorEl && repUpwardEditorEl.value.trim() === '' && r.upward) {
    repUpwardEditorEl.value = r.upward
  }
  if (r.weekly) {
    repCopyBtn.hidden = false
    repCopyWechatBtn.hidden = false
    repCopyEmailBtn.hidden = false
  }
  if (r.upward) {
    repUpwardCopyBtn.hidden = false
    repUpwardWechatBtn.hidden = false
    repUpwardEmailBtn.hidden = false
  }
}
window.addEventListener('hashchange', () => {
  if (window.location.hash.replace('#', '') === 'screen-6') {
    refreshRepStats()
    updateRepGenerateBtn()
    loadSavedReportIntoEditor()
  }
})

// ============================================================
// 第 7 屏：新人开挂室（书单 + 困境；困境支持输入后由 AI 生成同格式三套解法）
// ============================================================
const BOOK_STATUS_KEY = 'odb_book_status' // {bookId: 'want'|'reading'|'read'}，books.json 的 status 仅为默认值
const BOOK_NOTES_KEY = 'odb_book_notes' // P1：{bookId: '一句话读书笔记'}，纯本地
const DILEMMA_FAV_KEY = 'odb_dilemma_fav' // 困境 id 数组
const DILEMMA_CUSTOM_KEY = 'odb_dilemma_custom' // AI 拆解的自定义困境数组（与 dilemmas.json 条目同格式）

// ===== 第 7 屏 DOM =====
const openTabsEl = $('open-tabs')
const openPanelBooksEl = $('open-panel-books')
const openPanelDilemmasEl = $('open-panel-dilemmas')
const openRoleFilterEl = $('open-role-filter')
const openStageFiltersEl = $('open-stage-filters')
const openBooksEl = $('open-book-stack')
const openBooksEmptyEl = $('open-books-empty')
const openDilemmaInputEl = $('open-dilemma-input')
const openDilemmaBreakEl = $('open-dilemma-break')
const openDilemmaTagsEl = $('open-dilemma-tags')
const openFavOnlyEl = $('open-fav-only')
const openDilemmaMatchEl = $('open-dilemma-match')
const openDilemmaDetailEl = $('open-dilemma-detail')
const openDetailPanelEl = $('open-detail-panel')
const openReaderEl = $('open-reader')
const openReaderTitleEl = $('open-reader-title')
const openReaderPagesEl = $('open-reader-pages')
const openReaderDotsEl = $('open-reader-dots')
const openReaderPrevEl = $('open-reader-prev')
const openReaderNextEl = $('open-reader-next')
const openReaderCloseEl = $('open-reader-close')

const PRIO_ORDER = { P0: 0, P1: 1, P2: 2 }
const STAGE_ORDER = { 入职前: 0, '入职1个月': 1, '入职3个月': 2 }
const DOT_LABELS = { want: '想读', reading: '在读', read: '已读' }
const PRIO_LABELS = { P0: 'P0 必读', P1: 'P1 进阶', P2: 'P2 拓展' }

let bookRoleFilter = 'all'
let bookStageFilter = 'all'
let selectedDilemmaId = null
let favOnly = false
let selectedBookId = null // 当前选中的书（卡片高亮 + 右侧详情面板）
let currentBookIndex = 0 // 堆叠卡片：当前展示的书在筛选列表中的下标
let filteredBookList = [] // 当前筛选+排序后的书列表，供堆叠切换使用
let readerBook = null // 阅读面板当前打开的书
let readerPage = 0
let readerPages = [] // 3 个页元素，翻页只改 transform 不改 DOM

function loadBookStatus() {
  try {
    return JSON.parse(localStorage.getItem(BOOK_STATUS_KEY)) || {}
  } catch {
    return {}
  }
}

function saveBookStatus(m) {
  localStorage.setItem(BOOK_STATUS_KEY, JSON.stringify(m))
}

// ===== P1：读书笔记（一句话，纯本地） =====
function loadBookNotes() {
  try {
    return JSON.parse(localStorage.getItem(BOOK_NOTES_KEY)) || {}
  } catch {
    return {}
  }
}

function saveBookNotes(m) {
  localStorage.setItem(BOOK_NOTES_KEY, JSON.stringify(m))
}

// 笔记输入框：失焦即存，清空文本即删除笔记
function buildNoteBox(b) {
  const box = el('div', 'open-note-box')
  box.append(el('div', 'open-panel-sec-label', '我的读书笔记（存本地）'))
  const ta = el('textarea', 'open-note-input')
  ta.rows = 2
  ta.placeholder = '写一句读后感，或者你为什么想读这本书…'
  ta.value = loadBookNotes()[b.id] || ''
  ta.addEventListener('blur', () => {
    const m = loadBookNotes()
    const v = ta.value.trim()
    if (v) m[b.id] = v
    else delete m[b.id]
    saveBookNotes(m)
    showToast(v ? '笔记已保存' : '笔记已清空')
  })
  box.append(ta)
  return box
}

function loadDilemmaFav() {
  try {
    return JSON.parse(localStorage.getItem(DILEMMA_FAV_KEY)) || []
  } catch {
    return []
  }
}

function saveDilemmaFav(list) {
  localStorage.setItem(DILEMMA_FAV_KEY, JSON.stringify(list))
}

// ===== 自定义困境（AI 生成，存本地，与预置困境同格式同渲染） =====
function loadCustomDilemmas() {
  try {
    const v = JSON.parse(localStorage.getItem(DILEMMA_CUSTOM_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function saveCustomDilemmas(list) {
  // 最多保留 20 条，防止无限膨胀
  localStorage.setItem(DILEMMA_CUSTOM_KEY, JSON.stringify(list.slice(0, 20)))
}

// 预置 + 自定义的统一视图；自定义排在最前面（最新拆解优先展示）
function getAllDilemmas() {
  return [...loadCustomDilemmas(), ...dilemmasData.dilemmas]
}

// ===== 标签切换 =====
function setOpenTab(tab) {
  document.querySelectorAll('.open-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  openPanelBooksEl.hidden = tab !== 'books'
  openPanelDilemmasEl.hidden = tab !== 'dilemmas'
}

openTabsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.open-tab')
  if (b) setOpenTab(b.dataset.tab)
})

// ===== 书单 =====
function getBookStatus(b) {
  const m = loadBookStatus()
  return m[b.id] || b.status || 'want'
}

function renderRoleFilter() {
  const roles = [...new Set(booksData.books.flatMap((b) => b.forRoles || []))].filter((r) => r !== '全部')
  openRoleFilterEl.innerHTML = ''
  const all = el('option', '', '全部岗位')
  all.value = 'all'
  openRoleFilterEl.append(all)
  for (const r of roles) {
    const opt = el('option', '', r)
    opt.value = r
    openRoleFilterEl.append(opt)
  }
  openRoleFilterEl.value = bookRoleFilter
}

function renderBooks() {
  const statusMap = loadBookStatus()
  let list = [...booksData.books]
  // 筛选：岗位（forRoles 含该岗位或含「全部」）+ 阅读阶段，AND 叠加
  if (bookRoleFilter !== 'all') {
    list = list.filter((b) => (b.forRoles || []).includes(bookRoleFilter) || (b.forRoles || []).includes('全部'))
  }
  if (bookStageFilter !== 'all') {
    list = list.filter((b) => (b.readingStage || '入职前') === bookStageFilter)
  }
  // 排序：priority → readingStage → title
  list.sort(
    (a, b) =>
      PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
      STAGE_ORDER[a.readingStage || '入职前'] - STAGE_ORDER[b.readingStage || '入职前'] ||
      a.title.localeCompare(b.title, 'zh-Hans-CN'),
  )
  filteredBookList = list
  if (currentBookIndex >= list.length) currentBookIndex = 0
  openBooksEl.innerHTML = ''
  openBooksEmptyEl.hidden = list.length > 0
  if (!list.length) return
  openBooksEl.hidden = false

  const cur = list[currentBookIndex]

  // 堆叠舞台：左右各露出 3 本书脊，环形循环；左右切换箭头在舞台外侧
  const stageWrap = el('div', 'open-stack-stage-wrap')
  const stage = el('div', 'open-stack-stage')
  const PEEK = 3
  const n = list.length

  // 左侧书脊：从远到近（-3 → -1）
  for (let k = PEEK; k >= 1; k--) {
    const idx = (currentBookIndex - k + n) % n
    const peek = buildStackCard(list[idx])
    peek.classList.add('peek')
    peek.style.setProperty('--peek', -k)
    peek.style.setProperty('--peek-abs', k)
    peek.style.zIndex = 10 - k
    peek.dataset.idx = idx
    peek.addEventListener('click', () => {
      currentBookIndex = idx
      renderBooks()
    })
    stage.append(peek)
  }

  const main = buildStackCard(cur)
  main.classList.add('main')
  const status = statusMap[cur.id] || cur.status || 'want'
  const dot = el('button', 'open-book-dot dot-' + status, status === 'read' ? '✓' : '')
  dot.type = 'button'
  dot.title = `${DOT_LABELS[status]}（点击切换）`
  dot.setAttribute('aria-label', '切换阅读状态：' + DOT_LABELS[status])
  dot.addEventListener('click', (e) => {
    e.stopPropagation()
    cycleBookStatus(cur)
  })
  main.append(dot)
  stage.append(main)

  // 右侧书脊：从近到远（+1 → +3）
  for (let k = 1; k <= PEEK; k++) {
    const idx = (currentBookIndex + k) % n
    const peek = buildStackCard(list[idx])
    peek.classList.add('peek')
    peek.style.setProperty('--peek', k)
    peek.style.setProperty('--peek-abs', k)
    peek.style.zIndex = 10 - k
    peek.dataset.idx = idx
    peek.addEventListener('click', () => {
      currentBookIndex = idx
      renderBooks()
    })
    stage.append(peek)
  }

  const prevBtn = el('button', 'open-stack-arrow open-stack-arrow-prev', '‹')
  prevBtn.type = 'button'
  prevBtn.setAttribute('aria-label', '上一本')
  prevBtn.addEventListener('click', () => stepBook(-1))
  const nextBtn = el('button', 'open-stack-arrow open-stack-arrow-next', '›')
  nextBtn.type = 'button'
  nextBtn.setAttribute('aria-label', '下一本')
  nextBtn.addEventListener('click', () => stepBook(1))

  stageWrap.append(prevBtn, stage, nextBtn)
  openBooksEl.append(stageWrap)

  // 信息区：左侧标签/书名/作者/概括/评价，右侧立即阅读
  const info = el('div', 'open-stack-info')
  const body = el('div', 'open-stack-body')
  const tags = el('div', 'open-stack-tags')
  const tagList = [cur.category, PRIO_LABELS[cur.priority] || cur.priority]
  for (const r of cur.forRoles || []) if (r !== '全部') tagList.push(r)
  if (cur.readingStage) tagList.push(cur.readingStage)
  for (const t of tagList) tags.append(el('span', 'open-stack-tag', t))
  body.append(tags)
  body.append(el('h3', 'open-stack-title', cur.title))
  body.append(el('p', 'open-stack-author', cur.author))
  body.append(el('p', 'open-stack-summary', cur.summary || ''))
  const rev = (cur.reviews || [])[0]
  if (rev) {
    const revBox = el('div', 'open-stack-review')
    revBox.append(el('span', 'open-stack-review-label', '豆瓣评价'))
    revBox.append(el('p', 'open-stack-review-text', '“' + (rev.text || '') + '”'))
    revBox.append(el('span', 'open-stack-review-user', '—— ' + (rev.user || '豆瓣用户')))
    body.append(revBox)
  }
  const actions = el('div', 'open-stack-actions')
  const readBtn = el('button', 'btn-primary open-stack-read', '立即阅读')
  readBtn.type = 'button'
  readBtn.addEventListener('click', () => {
    window.open(`https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(cur.title)}`, '_blank')
  })
  actions.append(readBtn)
  info.append(body, actions)
  openBooksEl.append(info)
}

// 单张堆叠卡（封面 + 降级文字层），不含交互
function buildStackCard(b) {
  const card = el('div', 'open-stack-card')
  card.dataset.id = b.id
  const cover = el('div', 'open-book-cover')
  const textLayer = el('div', 'open-book-cover-text')
  textLayer.append(el('div', 'open-book-title', b.title), el('div', 'open-book-author', b.author))
  cover.append(textLayer)
  if (b.coverUrl) {
    const img = el('img', 'open-book-cover-img')
    img.alt = b.title
    img.loading = 'eager'
    img.addEventListener('load', () => {
      img.style.display = 'block'
      textLayer.style.display = 'none'
    })
    img.addEventListener('error', () => img.remove())
    img.src = `${import.meta.env.BASE_URL}${b.coverUrl}`
    cover.append(img)
  }
  card.append(cover)
  return card
}

// 堆叠左右切换：上一本 / 下一本（环形）
function stepBook(dir) {
  const n = filteredBookList.length
  if (!n) return
  currentBookIndex = (currentBookIndex + dir + n) % n
  renderBooks()
}

// 圆点循环：想读 → 在读 → 已读 → 想读，只写 localStorage，绝不写回 books.json
function cycleBookStatus(b) {
  const m = loadBookStatus()
  const cur = m[b.id] || b.status || 'want'
  const next = cur === 'want' ? 'reading' : cur === 'reading' ? 'read' : 'want'
  m[b.id] = next
  saveBookStatus(m)
  renderBooks()
}

// ===== 选中书：卡片高亮 + 打开阅读面板（详情改为悬浮浮层，随悬停显示） =====
function selectBook(b) {
  selectedBookId = b.id
  document.querySelectorAll('.open-book-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === b.id))
  openDetailPanelEl.classList.remove('show')
  openReader(b)
}

// 浮层定位：优先放在书卡片右侧，右侧放不下翻到左侧，上下夹紧在视口内
function positionDetailPanel(anchor) {
  const rect = anchor.getBoundingClientRect()
  const W = 300
  const GAP = 12
  let left = rect.right + GAP
  if (left + W > window.innerWidth - 8) left = rect.left - W - GAP
  if (left < 8) left = 8
  let top = rect.top
  const H = Math.min(openDetailPanelEl.offsetHeight || 480, window.innerHeight - 16)
  if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8
  if (top < 8) top = 8
  openDetailPanelEl.style.left = `${left}px`
  openDetailPanelEl.style.top = `${top}px`
}

let detailHideTimer = null
function scheduleHideDetail() {
  clearTimeout(detailHideTimer)
  detailHideTimer = setTimeout(() => openDetailPanelEl.classList.remove('show'), 150)
}
function cancelHideDetail() {
  clearTimeout(detailHideTimer)
}

// ===== 右侧详情面板（桌面端 >1024px） =====
function renderDetailPanelEmpty() {
  openDetailPanelEl.innerHTML = emptyStateHTML('📖', '悬停或点击一本书', '这里会展示它的详情')
}

function showDetailPanel(b, anchor) {
  openDetailPanelEl.innerHTML = ''
  const head = el('div', 'open-panel-head')
  const coverBox = el('div', 'open-panel-cover')
  const textFallback = el('div', 'open-panel-cover-fallback')
  textFallback.append(el('div', 'open-panel-cover-fb-title', b.title), el('div', 'open-panel-cover-fb-author', b.author))
  coverBox.append(textFallback)
  if (b.coverUrl) {
    const img = el('img', 'open-panel-cover-img')
    img.alt = b.title
    img.addEventListener('load', () => {
      img.style.display = 'block'
      textFallback.style.display = 'none'
    })
    img.addEventListener('error', () => img.remove())
    img.src = `${import.meta.env.BASE_URL}${b.coverUrl}`
    coverBox.append(img)
  }
  const info = el('div', 'open-panel-info')
  info.append(el('div', 'open-panel-title', b.title), el('div', 'open-panel-author', b.author))
  head.append(coverBox, info)
  openDetailPanelEl.append(head)
  const tags = el('div', 'open-panel-tags')
  tags.append(el('span', 'open-tag', b.category), el('span', 'open-tag', PRIO_LABELS[b.priority] || b.priority))
  for (const r of b.forRoles || []) tags.append(el('span', 'open-tag', r))
  tags.append(el('span', 'open-tag', b.readingStage || ''))
  openDetailPanelEl.append(tags)
  openDetailPanelEl.append(el('div', 'open-panel-sec-label', '内容概括'))
  openDetailPanelEl.append(el('p', 'open-panel-summary', b.summary || ''))
  openDetailPanelEl.append(el('div', 'open-panel-sec-label', '读者评价 · 来自豆瓣'))
  const revList = el('div', 'open-panel-reviews')
  for (const r of b.reviews || []) {
    const item = el('div', 'open-panel-review')
    const top = el('div', 'open-panel-review-top')
    top.append(el('span', 'open-panel-review-user', r.user || '豆瓣用户'), el('span', 'open-panel-review-src', '豆瓣短评'))
    item.append(top, el('p', 'open-panel-review-text', r.text || ''))
    revList.append(item)
  }
  openDetailPanelEl.append(revList)
  const actions = el('div', 'open-panel-actions')
  const readBtn = el('button', 'btn-primary', '页内阅读')
  readBtn.type = 'button'
  readBtn.addEventListener('click', () => openReader(b))
  const doubanBtn = el('button', 'dash-ghost-btn', '豆瓣详情')
  doubanBtn.type = 'button'
  doubanBtn.addEventListener('click', () => {
    if (b.doubanUrl) window.open(b.doubanUrl, '_blank')
  })
  actions.append(readBtn, doubanBtn)
  openDetailPanelEl.append(actions)
  openDetailPanelEl.append(buildNoteBox(b)) // P1：一句话读书笔记
  openDetailPanelEl.classList.add('show')
  if (anchor) positionDetailPanel(anchor)
}

// ===== 全屏阅读面板（3 页翻页，不离开页面，不托管任何全文） =====
function openReader(b) {
  openDetailPanelEl.classList.remove('show')
  readerBook = b
  readerPage = 0
  openReaderTitleEl.textContent = b.title
  buildReaderPages(b)
  updateReaderView()
  openReaderEl.hidden = false
  document.body.classList.add('open-no-scroll')
}

function closeReader() {
  openReaderEl.hidden = true
  document.body.classList.remove('open-no-scroll')
}

function buildReaderPages(b) {
  openReaderPagesEl.innerHTML = ''
  readerPages = []

  // 第 1 页：这本书讲什么
  const p1 = el('div', 'open-reader-page')
  p1.append(el('div', 'open-reader-page-label', '这本书讲什么'))
  p1.append(el('p', 'open-reader-summary', b.summary || ''))
  if (b.reason) {
    const rb = el('div', 'open-reader-reason')
    rb.append(el('span', 'open-reader-reason-label', '一句话推荐：'), el('span', '', b.reason))
    p1.append(rb)
  }

  // 第 2 页：读者怎么说
  const p2 = el('div', 'open-reader-page')
  p2.append(el('div', 'open-reader-page-label', '读者怎么说'))
  p2.append(el('p', 'open-reader-src-note', '以下短评来自豆瓣，按热度排序'))
  for (const r of b.reviews || []) {
    const item = el('div', 'open-reader-review')
    item.append(el('div', 'open-reader-review-user', (r.user || '豆瓣用户') + '：'))
    item.append(el('p', 'open-reader-review-text', r.text || ''))
    p2.append(item)
  }

  // 第 3 页：开始阅读（唯一正版入口：微信读书外链）
  const p3 = el('div', 'open-reader-page open-reader-page-center')
  p3.append(el('div', 'open-reader-page-label', '开始阅读'))
  p3.append(el('p', 'open-reader-start-text', '这是正版阅读入口，第一次使用会跳转微信读书'))
  p3.append(buildNoteBox(b)) // P1：读完顺手记一句
  const actBox = el('div', 'open-reader-start-actions')
  const wereadBtn = el('button', 'btn-primary open-reader-weread', '去微信读书读全文')
  wereadBtn.type = 'button'
  wereadBtn.addEventListener('click', () => {
    window.open(`https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(b.title)}`, '_blank')
  })
  const doubanBtn = el('button', 'dash-ghost-btn', '查看豆瓣条目')
  doubanBtn.type = 'button'
  doubanBtn.addEventListener('click', () => {
    if (b.doubanUrl) window.open(b.doubanUrl, '_blank')
  })
  actBox.append(wereadBtn, doubanBtn)
  p3.append(actBox)

  readerPages = [p1, p2, p3]
  for (const pg of readerPages) openReaderPagesEl.append(pg)
}

function updateReaderView() {
  readerPages.forEach((pg, i) => {
    pg.style.transform = `translateX(${(i - readerPage) * 100}%)`
    pg.classList.toggle('active', i === readerPage)
  })
  openReaderDotsEl.innerHTML = ''
  for (let i = 0; i < readerPages.length; i++) {
    openReaderDotsEl.append(el('span', 'open-reader-dot' + (i === readerPage ? ' active' : '')))
  }
  openReaderPrevEl.disabled = readerPage === 0
  openReaderNextEl.disabled = readerPage === readerPages.length - 1
}

function goReaderPage(i) {
  if (!readerBook) return
  readerPage = Math.max(0, Math.min(readerPages.length - 1, i))
  updateReaderView()
}

openReaderPrevEl.addEventListener('click', () => goReaderPage(readerPage - 1))
openReaderNextEl.addEventListener('click', () => goReaderPage(readerPage + 1))
openReaderCloseEl.addEventListener('click', closeReader)
openReaderEl.addEventListener('click', (e) => {
  if (e.target === openReaderEl) closeReader()
})
document.addEventListener('keydown', (e) => {
  if (openReaderEl.hidden) return
  if (e.key === 'Escape') closeReader()
  else if (e.key === 'ArrowLeft') goReaderPage(readerPage - 1)
  else if (e.key === 'ArrowRight') goReaderPage(readerPage + 1)
})

// 浮层自身 hover 保持显示，移出后延迟隐藏
openDetailPanelEl.addEventListener('mouseenter', cancelHideDetail)
openDetailPanelEl.addEventListener('mouseleave', scheduleHideDetail)

openRoleFilterEl.addEventListener('change', () => {
  bookRoleFilter = openRoleFilterEl.value
  currentBookIndex = 0
  renderBooks()
})
openStageFiltersEl.addEventListener('click', (e) => {
  const b = e.target.closest('.open-stage-btn')
  if (!b) return
  bookStageFilter = b.dataset.stage
  document.querySelectorAll('.open-stage-btn').forEach((x) => x.classList.toggle('active', x === b))
  currentBookIndex = 0
  renderBooks()
})

// ===== 困境 =====

function gotoJobDecompose(jobName) {
  window.location.hash = 'screen-3'
  if (jobName) {
    const input = $('jd-composer-input')
    if (input) {
      input.value = jobName
      input.focus()
    }
  }
}

function renderDilemmaTags() {
  const fav = loadDilemmaFav()
  const all = getAllDilemmas()
  const list = favOnly ? all.filter((d) => fav.includes(d.id)) : all
  openDilemmaTagsEl.innerHTML = ''
  if (!list.length) {
    openDilemmaTagsEl.append(el('span', 'open-tags-empty', '还没有收藏的困境'))
    return
  }
  // 渲染一份原始序列，再克隆一份用于无缝轮播（事件委托在容器上，克隆项同样可点）
  const frag = document.createDocumentFragment()
  for (const d of list) {
    const tag = el(
      'button',
      'open-dilemma-tag' + (d.id === selectedDilemmaId ? ' active' : ''),
      (d.ai ? 'AI · ' : '') + (fav.includes(d.id) ? '☆ ' : '') + d.title,
    )
    tag.type = 'button'
    tag.dataset.id = d.id
    frag.append(tag)
  }
  openDilemmaTagsEl.append(frag)
  // 始终克隆一份用于无缝轮播（单条也克隆，保证 -50% 平移闭环）
  openDilemmaTagsEl.append(frag.cloneNode(true))
}

// 困境库轮播：事件委托，克隆项也能点击
openDilemmaTagsEl.addEventListener('click', (e) => {
  const t = e.target.closest('.open-dilemma-tag')
  if (t && t.dataset.id) selectDilemma(t.dataset.id)
})

function selectDilemma(id) {
  selectedDilemmaId = id
  renderDilemmaTags()
  const d = getAllDilemmas().find((x) => x.id === id)
  if (!d) return
  renderDilemmaDetail(d)
}

// 三栏解法：顺序严格跟随 JSON 的 solutions 数组（强硬/迂回/共赢），逐字段渲染
function renderDilemmaDetail(d) {
  const fav = loadDilemmaFav()
  const faved = fav.includes(d.id)
  openDilemmaDetailEl.innerHTML = ''
  const wrap = el('div', 'open-solutions')
  wrap.append(el('h3', 'open-dilemma-title', d.title))

  const dLead = memoryLeadIn()
  if (dLead) wrap.append(el('div', 'open-memory-note', dLead))
  const dKind = DEMO_MODE ? 'demo' : d.ai ? 'real-ai' : 'real-curated'
  prependHTML(wrap, aiProvHTML(dKind))

  const cols = el('div', 'open-solution-cols')
  for (const s of d.solutions) {
    const card = el('div', 'open-solution-card')
    const favBtn = el('button', 'open-solution-fav' + (faved ? ' faved' : ''), faved ? '★' : '☆')
    favBtn.type = 'button'
    favBtn.title = faved ? '取消收藏这条困境' : '收藏这条困境'
    favBtn.addEventListener('click', () => toggleDilemmaFav(d.id))
    card.append(favBtn)
    card.append(el('div', 'open-solution-style', s.style))
    card.append(el('p', 'open-solution-say', '「' + s.say + '」'))
    card.append(el('p', 'open-solution-do', s.do))
    card.append(el('p', 'open-solution-scene', '适用场景：' + s.scene))
    card.append(el('p', 'open-solution-caution', '⚠ ' + s.caution))
    cols.append(card)
  }
  wrap.append(cols)
  openDilemmaDetailEl.append(wrap)
}

function toggleDilemmaFav(id) {
  const fav = loadDilemmaFav()
  const i = fav.indexOf(id)
  if (i >= 0) fav.splice(i, 1)
  else fav.unshift(id)
  saveDilemmaFav(fav)
  renderDilemmaTags()
  if (selectedDilemmaId === id) {
    const d = getAllDilemmas().find((x) => x.id === id)
    if (d) renderDilemmaDetail(d)
  }
}

openFavOnlyEl.addEventListener('change', () => {
  favOnly = openFavOnlyEl.checked
  renderDilemmaTags()
})

// ===== 困境输入：本地关键词匹配 + AI 拆解兜底 =====
openDilemmaInputEl.addEventListener('input', () => {
  const kw = openDilemmaInputEl.value.trim()
  openDilemmaMatchEl.innerHTML = ''
  if (!kw) return
  const hits = getAllDilemmas().filter((d) => d.title.includes(kw))
  if (!hits.length) {
    openDilemmaMatchEl.append(el('p', 'open-match-empty', '库里没有这个困境，可以让 AI 按同样格式拆解一条'))
  }
  for (const d of hits) {
    const btn = el('button', 'open-match-item', (d.ai ? 'AI · ' : '') + d.title)
    btn.type = 'button'
    btn.addEventListener('click', () => {
      selectDilemma(d.id)
      openDilemmaInputEl.value = ''
      openDilemmaMatchEl.innerHTML = ''
    })
    openDilemmaMatchEl.append(btn)
  }
})

// 输入框内「破局」按钮 + 回车：按当前输入让 AI 拆解
function breakDilemma() {
  const kw = openDilemmaInputEl.value.trim()
  if (!kw) {
    openDilemmaInputEl.focus()
    return
  }
  generateCustomDilemma(kw)
}
openDilemmaBreakEl.addEventListener('click', breakDilemma)
openDilemmaInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    breakDilemma()
  }
})

// ===== AI 拆解自定义困境（DeepSeek，输出与 dilemmas.json 完全同格式） =====
const DILEMMA_AI_PROMPT = [
  '你是「职场新人困境拆解器」。用户描述一个刚入职场遇到的具体困境，你输出三套解法：强硬、迂回、共赢，顺序固定。',
  '',
  '输出要求（严格遵守）：',
  '1. 只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码块。',
  '2. 结构固定：{"title":"给困境起一个 12 字以内的短标题","tags":["标签1","标签2"],"solutions":[{"style":"强硬","say":"…","do":"…","scene":"…","caution":"…"},{…迂回…},{…共赢…}]}',
  '3. solutions 固定 3 项，style 依次为 强硬、迂回、共赢。',
  '4. say 必须是能直接照着说出口的具体话术（口语、含称呼或开场），禁止「加强沟通」这类正确废话。',
  '5. do 讲具体怎么做；scene 说明适用场景；caution 指出这条解法的风险或边界，都要具体。',
  '6. 语气像一个带过新人的老同事在给实在建议：直接、具体、不端着。',
  '',
  '格式示例（仅示意格式，内容必须针对用户输入重新生成）：',
  '{"title":"不敢问问题","tags":["新人高频","学生思维"],"solutions":[{"style":"强硬","say":"（对自己）我先自己查 15 分钟，查不到就问，这是纪律。","do":"给自己立规矩：任何问题先自查 15 分钟，到点就问，不恋战。","scene":"自我管理层面","caution":"别把 15 分钟变成 3 小时"},{"style":"迂回","say":"哥/姐，我查了文档和历史消息，X 部分我理解是 A，想确认下对不对？","do":"问问题时带上已做过的功课，把开放问题变成选择题。","scene":"问不熟的同事","caution":"功课真的要做，装样子会被识破"},{"style":"共赢","say":"mentor，我整理了一份《常见问题清单》，您看有没有要补充的？","do":"把自己的困惑沉淀成文档，帮到后面所有人。","scene":"想建立存在感的时候","caution":"拿不准的标注待确认，不要瞎写"}]}',
].join('\n')

let dilemmaGenerating = false
let dilemmaLastAsk = ''

function renderDilemmaStatus(kind, msg = '') {
  openDilemmaMatchEl.innerHTML = ''
  const card = el('div', 'open-dilemma-status' + (kind === 'error' || kind === 'key' ? ' open-dilemma-status-error' : ''))
  if (kind === 'loading') {
    card.append(el('span', 'dilemma-spinner'), el('span', 'open-dilemma-status-text', '正在拆解，约需 10~20 秒…'))
  } else if (kind === 'key') {
    card.append(el('span', 'open-dilemma-status-icon', '🔑'), el('span', 'open-dilemma-status-text', '还没配置 DeepSeek API Key：复制 .env.example 为 .env，填入 key 后刷新页面'))
  } else if (kind === 'error') {
    card.append(el('span', 'open-dilemma-status-icon', '⚠️'), el('span', 'open-dilemma-status-text', '拆解失败：' + msg))
    const retry = el('button', 'open-dilemma-ai-btn', '重试')
    retry.type = 'button'
    retry.addEventListener('click', () => generateCustomDilemma(dilemmaLastAsk))
    card.append(retry)
  }
  openDilemmaMatchEl.append(card)
}

function normalizeAIDilemma(raw) {
  if (!raw || typeof raw !== 'object') return null
  const solutions = Array.isArray(raw.solutions) ? raw.solutions : []
  const styles = ['强硬', '迂回', '共赢']
  const fixed = []
  for (const want of styles) {
    const s =
      solutions.find((x) => x && x.style === want) ||
      solutions[styles.indexOf(want)] ||
      {}
    fixed.push({
      style: want,
      say: String(s.say || '').trim(),
      do: String(s.do || '').trim(),
      scene: String(s.scene || '').trim(),
      caution: String(s.caution || '').trim(),
    })
  }
  if (fixed.some((s) => !s.say || !s.do)) return null // 关键字段缺失视为格式失败
  const title = String(raw.title || dilemmaLastAsk).trim().slice(0, 20) || '我的困境'
  const tags = Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map((t) => String(t).trim()).filter(Boolean) : ['AI 拆解']
  return { title, tags, solutions: fixed }
}

async function generateCustomDilemma(text) {
  if (dilemmaGenerating) return
  const ask = (text || openDilemmaInputEl.value || '').trim()
  if (!ask) return
  dilemmaLastAsk = ask
  if (DEMO_MODE) {
    demoCustomDilemma(ask)
    return
  }
  dilemmaGenerating = true
  renderDilemmaStatus('loading')
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: DILEMMA_AI_PROMPT },
          { role: 'user', content: `我的困境：${ask}` },
        ],
        temperature: 0.6,
        max_tokens: 1400,
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    let content = stripCodeFence((data.choices?.[0]?.message?.content || '').trim())
    // 兜底：截取首尾大括号之间的 JSON 主体，防模型嘴瓢
    const s = content.indexOf('{')
    const e = content.lastIndexOf('}')
    if (s >= 0 && e > s) content = content.slice(s, e + 1)
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('AI 返回格式异常，请重试一次')
    }
    const d = normalizeAIDilemma(parsed)
    if (!d) throw new Error('AI 返回内容不完整，请重试一次')
    d.id = 'c' + Date.now()
    d.ai = true // 自定义困境标记（渲染 AI 前缀用，不依赖 id 前缀判断）
    const list = loadCustomDilemmas()
    list.unshift(d)
    saveCustomDilemmas(list)
    selectedDilemmaId = d.id
    renderDilemmaTags()
    renderDilemmaDetail(d)
    openDilemmaInputEl.value = ''
    openDilemmaMatchEl.innerHTML = ''
    logActivity('dilemma-ai', `AI 拆解困境：${d.title}`)
    const p = loadProfile()
    updateProfile({ dilemmasTackled: Array.from(new Set([...(p.dilemmasTackled || []), d.title])).slice(-10) })
    renderOnboardingProgress()
  } catch (err) {
    renderDilemmaStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    dilemmaGenerating = false
  }
}

// ============================================================
// 第 8 屏：关于 & 初衷（纯静态文案，无交互逻辑）
// ============================================================

// ===== 第 7 屏初始化 =====
renderRoleFilter()
renderBooks()
renderDilemmaTags()

// ============================================================
// 第 3 屏 v2：JD 拆解 Agent（v1 逻辑一行未改，以下全部为新增）
// ============================================================
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const ZHIPU_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY || ''

// ===== v2 DOM（入口已合并进 #jd-composer） =====
const jdUploadBtn = $('jd-upload-btn')
const jdOcrFileEl = $('jd-composer-ocr')
const jdStatusEl = $('jd-status')
const jdResultEl = $('jd-result')
const jdChatEl = $('jd-chat')
const jdChatBoxEl = $('jd-chat-box')
const jdChatInputEl = $('jd-chat-input')
const jdChatSendEl = $('jd-chat-send')
const jdChatMetaEl = $('jd-chat-meta')
const jdChatSaveDilemmaBtnEl = $('jd-chat-save-dilemma')
const jdChatGotoOpenBtnEl = $('jd-chat-goto-open')

let jdParsing = false
let jdChatMessages = [] // 对话历史只保留在内存，不落 localStorage
let jdChatSystem = '' // Prompt③ + 本次岗位地图 JSON
let jdLastJobName = '' // 最近一次拆解的岗位名（用于「存为困境」关联 relatedJobId）
let jdChatLastPair = null // 最近一组问答 {question, answer}，供「存为困境」按钮使用
let jdChatBusy = false

// ===== 一键拆解：按输入内容自动路由 =====
// 含换行或超过 40 字 → 视为 JD 原文，走 parseJd；否则视为岗位名，走 generate
function isJdText(text) {
  return text.includes('\n') || text.length > 40
}

function routeBreakdown() {
  const text = inputEl.value.trim()
  if (!text) {
    inputEl.focus()
    return
  }
  if (isJdText(text)) {
    // 切到 JD 模式：清掉岗位名模式的结果区
    statusEl.innerHTML = ''
    resultEl.innerHTML = ''
    parseJd()
  } else {
    // 切到岗位名模式：清掉 JD 模式的结果区
    jdStatusEl.innerHTML = ''
    jdResultEl.innerHTML = ''
    jdChatEl.hidden = true
    generate()
  }
}

// 上传截图 → 触发隐藏的 file input
jdUploadBtn.addEventListener('click', () => jdOcrFileEl.click())

// 演示模式：上传任意截图后自动填入一段示例 JD，无需配置智谱 Key
const DEMO_JD_TEXT = `产品经理（应届生）
岗位职责：
1. 负责需求调研、用户访谈，输出需求文档；
2. 跟进产品迭代，协调设计、开发、测试资源；
3. 分析产品核心数据，输出周报与复盘；
4. 参与竞品分析与行业研究。
任职要求：
1. 本科及以上学历，计算机/心理学/商科优先；
2. 具备优秀的逻辑思维与沟通能力；
3. 有实习或项目经验者优先。`

// ===== 截图提字（智谱 GLM-4V-Flash） =====
if (!ZHIPU_API_KEY) {
  jdUploadBtn.title = '演示模式：上传截图将自动填入示例 JD'
}

jdOcrFileEl.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  // 演示模式：无智谱 Key 时直接填入示例 JD
  if (!ZHIPU_API_KEY) {
    inputEl.value = DEMO_JD_TEXT
    renderJdStatus('ocr-success')
    return
  }
  renderJdStatus('ocr-loading')
  try {
    const dataUrl = await compressImage(file, 1280, 0.8)
    const res = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4v-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: jdOcrPrompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      const errMap = {
        401: '智谱 API Key 无效，请检查 .env 里的 VITE_ZHIPU_API_KEY',
        429: '智谱接口请求太频繁，稍等几秒再试',
      }
      throw new Error(errMap[res.status] || `智谱接口异常（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content || '').trim()
    // 结果过短或有效文字太少 → 视为没认出有效文字
    const meaningful = text.replace(/[\s\p{P}\p{S}〔〕?？]+/gu, '')
    if (!text || meaningful.length < 6) {
      renderJdStatus('ocr-empty')
      return
    }
    inputEl.value = text
    renderJdStatus('ocr-success')
  } catch (err) {
    renderJdStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  }
})

// 图片压缩：等比缩到宽边 ≤ maxW，转 jpeg（质量 quality），输出带 data: 前缀的 base64
function compressImage(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      const scale = Math.min(1, maxW / Math.max(w, h))
      w = Math.round(w * scale)
      h = Math.round(h * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('图片压缩失败，请换一张试试'))
            return
          }
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('图片读取失败，请重试'))
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败，请换一张试试'))
    }
    img.src = url
  })
}

// ===== 首次 JD 拆解（DeepSeek） =====
// parseJd 由 routeBreakdown 直接调用，不再单独绑按钮

async function parseJd() {
  const text = inputEl.value.trim()
  if (!text) {
    inputEl.focus()
    return
  }
  if (jdParsing) return
  if (DEMO_MODE) {
    demoParseJd(text)
    return
  }
  jdParsing = true
  generateBtn.disabled = true
  generateBtn.textContent = '拆解中…'
  jdResultEl.innerHTML = ''
  jdChatEl.hidden = true
  renderJdStatus('loading')
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: jdAgentPrompt },
          { role: 'user', content: `以下是用户提供的 JD 原文：\n${text}\n请按铁律拆解。JD 里的套话不要复述，读出它没写的部分。` },
        ],
        temperature: 0.7,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空，请重试')
    let job
    try {
      job = parseJsonSafe(content)
    } catch {
      throw new Error('AI 输出格式异常，请重试')
    }
    // 非 JD 输入引导：jobName 或 oneLineTruth 为空 → 不渲染卡片
    if (!job.jobName || !job.oneLineTruth) {
      renderJdStatus('not-jd')
      return
    }
    jdLastJobName = job.jobName
    renderJdResult(job)
    // 展开追问区（有旧内容先清空）
    jdChatMessages = []
    jdChatSystem = jdChatPrompt.replace('{上一步生成的 JSON}', JSON.stringify(job))
    jdChatBoxEl.innerHTML = ''
    jdChatEl.hidden = false
    renderJdStatus('none')
  } catch (err) {
    renderJdStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    jdParsing = false
    generateBtn.disabled = false
    generateBtn.textContent = '一键拆解'
  }
}

function renderJdStatus(kind, msg = '') {
  jdStatusEl.innerHTML = ''
  if (kind === 'none') return
  const isWarn = kind === 'error' || kind === 'key' || kind === 'not-jd' || kind === 'ocr-empty'
  const card = el(
    'div',
    'jd-status' + (isWarn ? ' jd-status-error' : kind === 'ocr-success' ? ' jd-status-success' : ''),
  )
  if (kind === 'loading' || kind === 'ocr-loading') {
    card.append(el('div', 'jd-spinner'), el('p', 'jd-status-text', kind === 'loading' ? '正在拆解，约需 15~30 秒…' : '正在识别截图文字…'))
  } else if (kind === 'key') {
    card.append(
      el('div', 'jd-status-icon', '🔑'),
      el('h3', 'jd-status-title', '还没配置 DeepSeek API Key'),
      el('p', 'jd-status-text', '复制 .env.example 为 .env，填入你的 key 后刷新页面'),
    )
  } else if (kind === 'not-jd') {
    card.append(
      el('div', 'jd-status-icon', 'ℹ️'),
      el('h3', 'jd-status-title', '这看起来不是一份招聘 JD'),
      el('p', 'jd-status-text', '请粘贴真正的 JD 原文或重新上传截图'),
    )
  } else if (kind === 'ocr-empty') {
    card.append(
      el('div', 'jd-status-icon', 'ℹ️'),
      el('h3', 'jd-status-title', '没认出有效文字'),
      el('p', 'jd-status-text', '请检查截图或直接粘贴 JD 文本'),
    )
  } else if (kind === 'ocr-success') {
    card.append(el('div', 'jd-status-icon', '✅'), el('p', 'jd-status-text', '已提取截图文字，可修改后点「一键拆解」'))
  } else if (kind === 'error') {
    card.append(el('div', 'jd-status-icon', '⚠️'), el('h3', 'jd-status-title', '拆解失败'), el('p', 'jd-status-text', msg))
    const retry = el('button', 'btn-secondary', '重试')
    retry.type = 'button'
    retry.addEventListener('click', parseJd)
    card.append(retry)
  }
  jdStatusEl.append(card)
}

// ===== v2 结果卡片（8 模块 + jdDecoded 高亮板块） =====
function renderJdResult(job) {
  jdResultEl.innerHTML = ''
  const wrap = el('div', 'jd-result-wrap')
  const head = el('div', 'jd-result-head')
  const titleBox = el('div')
  titleBox.append(el('h2', 'jd-result-name', job.jobName))
  const meta = el('div', 'jd-result-meta')
  meta.append(el('span', 'jd-chip', 'JD 拆解'), el('span', 'jd-chip jd-chip-ghost', 'AI 生成'))
  titleBox.append(meta)
  head.append(titleBox)
  const favBtn = el('button', 'jd-fav-btn', '☆')
  favBtn.type = 'button'
  favBtn.title = '收藏到岗位库'
  favBtn.addEventListener('click', () => {
    saveToLibrary(job, jdLastJobName)
    favBtn.textContent = '★'
    favBtn.classList.add('faved')
    favBtn.disabled = true
  })
  head.append(favBtn)
  wrap.append(head)

  // oneLineTruth 大字
  if (job.oneLineTruth) {
    const truth = el('div', 'jd-truth')
    truth.append(el('div', 'jd-truth-label', '一句话本质'), el('p', 'jd-truth-text', job.oneLineTruth))
    wrap.append(truth)
  }

  // jdDecoded 高亮板块（无字段不渲染，兼容 v1 旧收藏）
  const decoded = Array.isArray(job.jdDecoded) ? job.jdDecoded.filter(Boolean) : []
  if (decoded.length) {
    const box = el('div', 'jd-decoded')
    box.append(el('div', 'jd-decoded-title', 'JD 没写的大实话'))
    for (const line of decoded) {
      const parts = line.split('→')
      const row = el('div', 'jd-decoded-line')
      row.append(el('span', 'jd-decoded-jd', parts[0] || line))
      row.append(el('span', 'jd-decoded-arrow', '→'))
      row.append(el('span', 'jd-decoded-real', parts[1] || ''))
      box.append(row)
    }
    wrap.append(box)
  }

  // 8 模块（复用 MODULES 常量与 v1 卡片类名）
  const grid = el('div', 'modules-grid')
  for (const m of MODULES) {
    const items = Array.isArray(job[m.key]) ? job[m.key] : []
    if (!items.length) continue
    const card = el('section', 'module-card module-card--' + m.key)
    const headBtn = el('button', 'module-head')
    headBtn.type = 'button'
    const titleSpan = el('span', 'module-title', m.title)
    if (m.type === 'checklist') {
      const checkIcon = document.createElement('span')
      checkIcon.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      titleSpan.append(checkIcon)
    }
    headBtn.append(titleSpan, el('span', 'module-count', String(items.length)))
    headBtn.addEventListener('click', () => card.classList.toggle('collapsed'))
    const collapse = el('div', 'module-collapse')
    const body = el('div', 'module-body')
    populateModuleBody(body, m, items)
    collapse.append(body)
    card.append(headBtn, collapse)
    grid.append(card)
  }
  wrap.append(grid)
  jdResultEl.append(wrap)
  requestAnimationFrame(() => syncBottomRowHeight())
}

// ===== 追问对话（DeepSeek 流式） =====
function appendJdMsg(role, text) {
  const msg = el('div', 'jd-msg jd-msg-' + role)
  msg.textContent = text || ''
  jdChatBoxEl.append(msg)
  jdChatBoxEl.scrollTop = jdChatBoxEl.scrollHeight
  return msg
}

// 数字列表前补换行（不引入 markdown 渲染库）
function formatJdChatText(text) {
  return text.replace(/([^\n])(\d+\.\s)/g, '$1\n$2')
}

// 演示模式：岗位追问的预置回答（与快捷按钮文案一一对应，也兼容任意输入）
function demoSendJdChat(question) {
  const q = question || jdChatInputEl.value
  const job = jdLastJobName || '目标岗位'
  const answers = {
    '这个岗位面试会问什么': `面试通常围绕三类问题展开：\n1. 业务理解：你会怎么分析这个产品的用户路径？当前核心指标是什么？\n2. 项目深挖：请讲一个你主导/参与过的项目，重点问「为什么这么做」「如果重来会怎么改」。\n3. 岗位匹配：你认为自己最适合这个岗位的 3 个特质是什么？\n\n建议：提前准备一个 3 分钟的项目故事，用 STAR 结构，数据收尾。`,
    '第一个月最重要的是什么': `${job} 入职第一个月，建议把 80% 精力放在「搞清楚人和事」：\n1. 第 1 周：约直属领导、mentor、核心协作方做 1:1，问清楚团队目标、考核口径、当前最大卡点。\n2. 第 2 周：读完核心文档（PRD、数据看板、历史复盘），整理一份「新人 10 问」。\n3. 第 3-4 周：主动承接 1 个能快速交付的小任务，先赢一次，建立信任。\n\n记住：第一个月不急着证明自己多强，先证明自己「靠谱、好协作」。`,
    '这份 JD 有哪些坑': `JD 里常见的 3 个「坑」需要警惕：\n1. 「负责全流程」可能是资源不足、边界模糊，入职后容易变成打杂。\n2. 「抗压能力强」「接受适度加班」往往意味着节奏快、KPI 紧，要问清具体工作时长。\n3. 「有机会接触 XX 核心业务」如果不在岗位职责前几条，可能只是边缘支持。\n\n建议：面试时把 JD 里模糊的动词变成具体的问题，比如「全流程」到底包含哪些评审节点、向谁汇报。`,
  }
  const answer =
    answers[q] ||
    `这个问题问得很好。针对「${job}」，我给你 3 个思考角度：\n1. 从岗位目标出发：这个岗位存在的核心 value 是什么？\n2. 从团队缺口出发：当前团队最缺的能力/资源是什么？\n3. 从个人成长出发：这个经历能补你哪块履历短板？\n\n如果你把具体 JD 或面试问题贴出来，我可以给更针对性的建议。`

  jdChatMessages.push({ role: 'user', content: q })
  appendJdMsg('user', q)
  jdChatInputEl.value = ''
  const aiMsg = appendJdMsg('ai', '')
  jdChatBusy = true
  jdChatSendEl.disabled = true
  jdChatSendEl.textContent = '回答中…'

  let pos = 0
  const full = formatJdChatText('【演示模式 · 预置回答】\n\n' + answer)
  const chunk = Math.max(2, Math.floor(full.length / 24))
  const timer = window.setInterval(() => {
    pos = Math.min(full.length, pos + chunk)
    aiMsg.textContent = full.slice(0, pos)
    jdChatBoxEl.scrollTop = jdChatBoxEl.scrollHeight
    if (pos >= full.length) {
      window.clearInterval(timer)
      jdChatMessages.push({ role: 'assistant', content: full })
      jdChatLastPair = { question: q, answer: full }
      jdChatMetaEl.hidden = false
      jdChatBusy = false
      jdChatSendEl.disabled = false
      jdChatSendEl.textContent = '发送'
      logActivity('demo-jd-chat', '演示模式岗位追问：' + q.slice(0, 30))
    }
  }, 35)
}

async function sendJdChat(question) {
  const q = (question || jdChatInputEl.value).trim()
  if (!q || jdChatBusy) return
  if (DEMO_MODE) {
    demoSendJdChat(q)
    return
  }
  jdChatMessages.push({ role: 'user', content: q })
  appendJdMsg('user', q)
  jdChatInputEl.value = ''
  const aiMsg = appendJdMsg('ai', '')
  jdChatBusy = true
  jdChatSendEl.disabled = true
  jdChatSendEl.textContent = '回答中…'
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: jdChatSystem }, ...jdChatMessages],
        temperature: 0.5,
        stream: true,
      }),
    })
    if (!res.ok) {
      throw new Error(ERROR_MSGS[res.status] || `网络异常或服务暂时不可用（HTTP ${res.status}），请稍后重试`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() // 最后一行可能不完整，留到下一轮
      for (const line of lines) {
        const s = line.trim()
        if (!s || s.startsWith(':')) continue
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') continue
        let chunk
        try {
          chunk = JSON.parse(payload)
        } catch {
          continue
        }
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          aiMsg.textContent = formatJdChatText(full)
          jdChatBoxEl.scrollTop = jdChatBoxEl.scrollHeight
        }
      }
    }
    if (!full.trim()) {
      aiMsg.textContent = '（AI 没有返回内容，请重试）'
    }
    jdChatMessages.push({ role: 'assistant', content: full.trim() })
    // 暴露最近一组问答给「存为困境」按钮
    jdChatLastPair = { question: q, answer: full.trim() }
    jdChatMetaEl.hidden = false
  } catch (err) {
    aiMsg.textContent = err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message || '发送失败，请重试'
  } finally {
    jdChatBusy = false
    jdChatSendEl.disabled = false
    jdChatSendEl.textContent = '发送'
  }
}

jdChatEl.querySelectorAll('.jd-quick-btn').forEach((b) => {
  b.addEventListener('click', () => sendJdChat(b.dataset.q))
})
jdChatSendEl.addEventListener('click', () => sendJdChat())
jdChatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendJdChat()
})

// ===== 屏3 → 屏7 打通：追问结果「存为困境」=====
function saveJdChatAsDilemma() {
  if (!jdChatLastPair) {
    showToast('还没有可以保存的问答')
    return
  }
  const { question, answer } = jdChatLastPair
  const list = loadCustomDilemmas()
  // 同岗位同问题去重
  const dup = list.find((d) => d.relatedJobId === jdLastJobName && d.title === question.slice(0, 40))
  if (dup) {
    showToast('已存过这条问答了')
    return
  }
  const summary = answer.replace(/\s+/g, ' ').trim().slice(0, 80) + (answer.length > 80 ? '…' : '')
  const dilemma = {
    id: `custom-${Date.now()}`,
    title: question.slice(0, 40) + (question.length > 40 ? '…' : ''),
    tags: ['岗位追问', jdLastJobName || '通用'],
    solutions: [{ summary, detail: answer, source: '岗位追问' }],
    relatedJobId: jdLastJobName,
    ai: true,
    createdAt: Date.now(),
  }
  list.unshift(dilemma)
  saveCustomDilemmas(list)
  showToast('已存为困境，去开挂室看看')
  jdChatGotoOpenBtnEl.hidden = false
  logActivity('dilemma-save', `岗位追问存为困境：${question.slice(0, 20)}`)
}

function gotoOpenScreen() {
  window.location.hash = 'screen-7'
  setOpenTab('dilemmas')
}

jdChatSaveDilemmaBtnEl.addEventListener('click', saveJdChatAsDilemma)
jdChatGotoOpenBtnEl.addEventListener('click', gotoOpenScreen)

// ============================================================
// 第 8 屏：数据管理（导出 / 导入 / 清空，覆盖全部用户数据 key）
// ============================================================
const DATA_KEYS = [
  'odb_todos',
  'odb_activities',
  'odb_projects',
  'odb_meetings',
  'odb_reports',
  'odb_book_status',
  'odb_book_notes', // P1：读书笔记
  'odb_dilemma_fav',
  'odb_dilemma_custom', // AI 拆解的自定义困境
  'job_library',
  'preset_favorites',
  'theme_preview',
]
const DATA_KEY_LABELS = {
  odb_todos: '待办',
  odb_activities: '动态',
  odb_projects: '项目',
  odb_meetings: '纪要',
  odb_reports: '周报',
  odb_book_status: '书单状态',
  odb_book_notes: '读书笔记',
  odb_dilemma_fav: '困境收藏',
  odb_dilemma_custom: '自定义困境',
  job_library: 'AI 岗位收藏',
  preset_favorites: '预置收藏',
  theme_preview: '主题',
}

const dataExportBtn = $('data-export-btn')
const dataImportBtn = $('data-import-btn')
const dataClearBtn = $('data-clear-btn')
const dataImportFileEl = $('data-import-file')
const dataMsgEl = $('data-msg')

// 导出当前全部数据为 JSON 文件（silent=true 用于导入前的自动备份）
function exportData(silent) {
  const data = {}
  for (const k of DATA_KEYS) {
    const v = localStorage.getItem(k)
    if (v != null) {
      try {
        data[k] = JSON.parse(v)
      } catch {
        data[k] = v
      }
    }
  }
  const payload = { app: 'onboarding-handbook', version: 1, exportedAt: new Date().toISOString(), data }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const d = new Date()
  a.download = `onboarding-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  if (!silent) dataMsgEl.textContent = `已导出，${Object.keys(data).length} 项数据已保存到文件`
}

dataExportBtn.addEventListener('click', () => exportData(false))
dataImportBtn.addEventListener('click', () => dataImportFileEl.click())

dataImportFileEl.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  let parsed
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    dataMsgEl.textContent = '文件格式不对'
    return
  }
  if (!parsed || parsed.app !== 'onboarding-handbook' || typeof parsed.data !== 'object' || parsed.data === null) {
    dataMsgEl.textContent = '文件格式不对'
    return
  }
  // 导入摘要
  const parts = []
  for (const k of DATA_KEYS) {
    if (!(k in parsed.data)) continue
    const v = parsed.data[k]
    const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 1
    parts.push(`${DATA_KEY_LABELS[k]} ${n}`)
  }
  const summary = parts.length ? parts.join(' / ') : '没有可导入的数据'
  if (!confirm(`将导入：${summary}\n导入前会自动备份当前数据。确认导入？`)) {
    dataMsgEl.textContent = '已取消导入'
    return
  }
  exportData(true) // 自动备份当前数据，防手滑覆盖
  for (const k of DATA_KEYS) {
    // 只覆盖文件里出现的 key，不删文件里没有的 key
    if (k in parsed.data) localStorage.setItem(k, JSON.stringify(parsed.data[k]))
  }
  location.reload()
})

dataClearBtn.addEventListener('click', () => {
  if (!confirm('确定清空全部数据？')) return
  if (!confirm('数据清空后不可恢复，真的要清空吗？')) {
    dataMsgEl.textContent = '已取消清空'
    return
  }
  for (const k of DATA_KEYS) localStorage.removeItem(k)
  location.reload()
})

// ============================================================
// P1：首次访问 3 步引导（只出现一次，存 odb_onboarded）
// ============================================================
const ONBOARDED_KEY = 'odb_onboarded'

function openOnboarding() {
  const existing = document.querySelector('.onboard-overlay')
  if (existing) existing.remove()
  const steps = [
    {
      icon: '🧭',
      title: '先拆一个岗位',
      text: '去「岗位拆解」：输入岗位名或粘贴一份 JD，AI 给你一份真实工作地图——日常在干什么、考核怎么算、第一个月的坑。',
    },
    {
      icon: '📋',
      title: '把排期粘贴进来',
      text: '去「工作台」：把待办、排期、聊天记录里领到的活直接粘贴，AI 帮你解析成清单、排出优先级和截止日。',
    },
    {
      icon: '📊',
      title: '每周五回来生成周报',
      text: '数据自动汇总、AI 组织成文，一键复制成微信消息或邮件发给领导。遇到困境，去「成长」屏挑一套解法。',
    },
  ]
  let step = 0

  const overlay = el('div', 'onboard-overlay')
  const card = el('div', 'onboard-card')
  const progressHost = el('div', 'onb-progress-host')
  progressHost.id = 'onb-progress-host'
  const icon = el('div', 'onboard-step-icon')
  const title = el('h3', 'onboard-step-title')
  const text = el('p', 'onboard-step-text')
  const dots = el('div', 'onboard-dots')
  const btnRow = el('div', 'onboard-btn-row')
  const skipBtn = el('button', 'onboard-skip-btn', '跳过')
  skipBtn.type = 'button'
  const mainBtn = el('button', 'btn-primary onboard-main-btn')
  mainBtn.type = 'button'

  function finish() {
    localStorage.setItem(ONBOARDED_KEY, '1')
    overlay.remove()
  }

  function render() {
    const s = steps[step]
    icon.textContent = s.icon
    title.textContent = '第 ' + (step + 1) + ' 步 · ' + s.title
    text.textContent = s.text
    mainBtn.textContent = step === steps.length - 1 ? '上岛' : '下一步'
    dots.innerHTML = ''
    steps.forEach((_, i) => dots.append(el('span', 'onboard-dot' + (i === step ? ' active' : ''))))
  }

  mainBtn.addEventListener('click', () => {
    if (step < steps.length - 1) {
      step++
      render()
    } else {
      finish()
    }
  })
  skipBtn.addEventListener('click', finish)
  // 键盘：Enter/Esc 关闭，→ 翻页
  document.addEventListener('keydown', function onKey(e) {
    if (!document.querySelector('.onboard-overlay')) {
      document.removeEventListener('keydown', onKey)
      return
    }
    if (e.key === 'Escape' || e.key === 'Enter') finish()
    else if (e.key === 'ArrowRight' && step < steps.length - 1) {
      step++
      render()
    }
  })

  btnRow.append(skipBtn, mainBtn)
  card.append(progressHost, icon, title, text, dots, btnRow)
  overlay.append(card)
  document.body.append(overlay)
  renderOnboardingProgress()
  render()
}

// 新人指引已删除：不再自动弹出，也不再从登陆进度卡片触发

// ============================================================
// 初始化收口：全部声明完成后,首次刷新工作台
// （refreshStats 读台账数据,必须在 PROJECTS_KEY 等声明之后调用）
// ============================================================
seedDemoLedger()
refreshDashboard()

// ============================================================
// 全局「我的收藏」抽屉（导航 ★ 收藏 入口；聚合岗位/困境/书单）
// 存储仍用各自 key（preset_favorites / job_library / odb_dilemma_fav /
// odb_book_status），不迁移数据，只在展示层聚合
// ============================================================
const favDrawerEl = $('fav-drawer')
const favDrawerMaskEl = $('fav-drawer-mask')
const favDrawerBodyEl = $('fav-drawer-body')

function collectAllFavorites() {
  // 岗位：AI 拆解收藏 + 预置岗位收藏
  const presetIds = getPresetFavorites()
  const jobs = [
    ...loadLibrary().map((j) => ({ id: j.id, title: j.name, sub: 'AI 拆解' })),
    ...jobsData.jobs.filter((j) => presetIds.includes(j.id)).map((j) => ({ id: j.id, title: j.name, sub: '岗位库' })),
  ]
  // 困境
  const favIds = loadDilemmaFav()
  const dilemmas = getAllDilemmas()
    .filter((d) => favIds.includes(d.id))
    .map((d) => ({ id: d.id, title: d.title, sub: d.ai ? 'AI 困境' : '困境' }))
  // 书（只统计用户主动标记过的想读/在读；books.json 默认 status 不算收藏）
  const statusMap = loadBookStatus()
  const books = booksData.books
    .filter((b) => ['want', 'reading'].includes(statusMap[b.id]))
    .map((b) => ({ id: b.id, title: b.title, sub: statusMap[b.id] === 'reading' ? '在读' : '想读' }))
  return { jobs, dilemmas, books }
}

function renderFavDrawer() {
  const { jobs, dilemmas, books } = collectAllFavorites()
  favDrawerBodyEl.innerHTML = ''

  const sections = [
    {
      icon: '🧭',
      title: `岗位 · ${jobs.length}`,
      items: jobs,
      action: (it) => gotoJobDecompose(it.title),
    },
    {
      icon: '🧩',
      title: `困境 · ${dilemmas.length}`,
      items: dilemmas,
      action: (it) => {
        setOpenTab('dilemmas')
        window.location.hash = 'screen-7'
        selectDilemma(it.id)
      },
    },
    {
      icon: '📚',
      title: `书单 · ${books.length}`,
      items: books,
      action: () => {
        setOpenTab('books')
        window.location.hash = 'screen-7'
      },
    },
  ]

  let total = 0
  for (const sec of sections) {
    total += sec.items.length
    if (!sec.items.length) continue
    favDrawerBodyEl.append(el('h4', 'fav-sec-title', `${sec.icon} ${sec.title}`))
    const list = el('div', 'fav-sec-list')
    for (const it of sec.items) {
      const row = el('button', 'fav-item')
      row.type = 'button'
      row.append(el('span', 'fav-item-title', it.title))
      row.append(el('span', 'fav-item-sub', it.sub))
      row.addEventListener('click', () => {
        closeFavDrawer()
        sec.action(it)
      })
      list.append(row)
    }
    favDrawerBodyEl.append(list)
  }

  if (total === 0) {
    favDrawerBodyEl.append(
      el('p', 'fav-empty', '还没有收藏。\n岗位库、困境解法、书单里的 ☆ 都会汇总到这里。'),
    )
  }
}

function openFavDrawer() {
  renderFavDrawer()
  favDrawerMaskEl.hidden = false
  requestAnimationFrame(() => favDrawerEl.classList.add('open'))
  document.body.style.overflow = 'hidden'
}

function closeFavDrawer() {
  favDrawerEl.classList.remove('open')
  favDrawerMaskEl.hidden = true
  document.body.style.overflow = ''
}

$('fav-drawer-close').addEventListener('click', closeFavDrawer)
favDrawerMaskEl.addEventListener('click', closeFavDrawer)
window.addEventListener('open-fav-drawer', openFavDrawer)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && favDrawerEl.classList.contains('open')) closeFavDrawer()
})

// ===== 首屏自动展示示例拆解（激活 / aha：reviewer 一进来就看到 AI 价值）=====
// demo 模式下，若结果区为空则自动渲染一份完整岗位拆解当「门面」，并预填输入框保持连贯；
// 真实 API 模式（配置了 Key）不自动跑，避免无谓的请求。用户一旦自己操作即被正常覆盖。
// ===== 演示模式「首屏即满血」：自动播种一整套真实感示例数据 =====
// 仅在 DEMO_MODE 且对应数据为空时写入，绝不覆盖用户自己产生的数据；
// 面试官/任何人首次打开（无 Key）即看到完整的拆解、台账、纪要、周报，第一印象不打折。
function seedDemoLedger() {
  if (!DEMO_MODE) return
  if (loadTodos().length || loadProjects().length) return // 已有数据不覆盖
  const ws = mondayStart().getTime()
  const h = (n) => ws + n * 3600000
  const seedTodos = [
    { id: 's1', title: '梳理本周产品需求池，输出优先级清单', dueDate: addDaysStr(-1), priority: '高', note: '示例台账', done: true, createdAt: h(6), doneAt: h(20) },
    { id: 's2', title: '输出 V2.3 上线复盘一页纸', dueDate: addDaysStr(-3), priority: '中', note: '示例台账', done: true, createdAt: h(8), doneAt: h(30) },
    { id: 's3', title: '补充搜索改版交互稿与埋点方案', dueDate: addDaysStr(3), priority: '高', note: '示例台账', done: false, createdAt: h(10) },
    { id: 's4', title: '跟进核心指标波动，写一页复盘', dueDate: addDaysStr(-1), priority: '中', note: '示例台账', done: false, createdAt: h(12) },
    { id: 's5', title: '约 mentor 做一次 1:1 对齐入职方向', dueDate: addDaysStr(6), priority: '中', note: '示例台账', done: false, createdAt: h(14) },
  ]
  saveTodos(seedTodos)
  saveProjects([
    { id: 'p-seed-1', name: '需求优先级看板重构', stage: '进行中', deadline: addDaysStr(7), owner: '我', risks: ['需求方临时加塞，排期可能被冲'], todoIds: [], createdAt: h(4), updatedAt: h(4) },
    { id: 'p-seed-2', name: '搜索改版（交互细化）', stage: '进行中', deadline: addDaysStr(10), owner: '我', risks: [], todoIds: [], createdAt: h(2), updatedAt: h(2) },
  ])
  if (typeof renderTodoList === 'function') renderTodoList()
  if (typeof renderProjectList === 'function') renderProjectList()
  if (typeof refreshStats === 'function') refreshStats()
}

function seedDemoMeetings() {
  if (!DEMO_MODE) return
  if (loadMeetings().length) return
  const day = 86400000
  const now = Date.now()
  const meetings = [
    {
      id: 'm-seed-1',
      title: '产品双周同步会',
      date: addDaysStr(-2),
      conclusions: [
        '本期核心目标对齐：Q3 聚焦「需求交付效率」与「新用户激活」两条主线',
        'V2.3 已上线，核心指标（次留、人均时长）符合预期，进入稳定观察期',
        '一致同意把「需求优先级看板」作为本月重点改进项',
      ],
      actionItems: [
        { task: '梳理本周需求池并按优先级排期，周五前同步', owner: '我', deadline: addDaysStr(2), priority: 'high' },
        { task: '输出 V2.3 上线复盘一页纸', owner: '我', deadline: addDaysStr(4), priority: 'medium' },
        { task: '约 mentor 做 1:1 对齐入职方向', owner: '我', deadline: addDaysStr(6), priority: 'medium' },
      ],
      openQuestions: ['下季度资源是否追加尚未确认，需要领导帮忙拍板'],
      createdAt: now - 2 * day,
    },
    {
      id: 'm-seed-2',
      title: '需求评审会（搜索改版）',
      date: addDaysStr(-4),
      conclusions: ['搜索改版方案通过初评，进入交互细化', '优先级定为高，纳入本月看板'],
      actionItems: [
        { task: '补充搜索改版的交互稿与埋点方案', owner: '我', deadline: addDaysStr(3), priority: 'high' },
      ],
      openQuestions: [],
      createdAt: now - 4 * day,
    },
  ]
  saveMeetings(meetings)
  if (typeof renderMeetHistory === 'function') renderMeetHistory()
}

function seedDemoWeekly() {
  if (!DEMO_MODE) return
  if (loadReports().length) return
  const snap = buildWeeklySnapshot()
  const weekly = buildWeeklyText(snap)
  const upward = buildUpwardText(snap)
  const report = { id: 'r-seed', weekStart: snap.weekStart, weekly, upward, createdAt: Date.now() }
  saveReports([report])
  if (repEditorEl) {
    repEditorEl.value = weekly
    repCopyBtn.hidden = false
    repCopyWechatBtn.hidden = false
    repCopyEmailBtn.hidden = false
    updateRepEditorClose()
  }
  if (repUpwardEditorEl) {
    repUpwardEditorEl.value = upward
    repUpwardCopyBtn.hidden = false
    repUpwardWechatBtn.hidden = false
    repUpwardEmailBtn.hidden = false
  }
  if (typeof renderRepHistory === 'function') renderRepHistory()
  if (typeof refreshRepStats === 'function') refreshRepStats()
}

// 一键清空演示数据，恢复初始空白（让面试官可重新以真实身份体验）
function clearDemoData() {
  ;[TODOS_KEY, PROJECTS_KEY, MEETINGS_KEY, REPORTS_KEY, LS_KEY, PRESET_FAV_KEY, PROFILE_KEY, ACT_KEY].forEach((k) =>
    localStorage.removeItem(k),
  )
  location.reload()
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'onb-demo-clear') {
    if (window.confirm('清空演示数据并恢复到初始空白状态？此操作不可撤销。')) clearDemoData()
  }
})

// 编排：首屏即播种全套示例 + 关键屏直接展示一份「门面」
function seedDemoExperience() {
  if (!DEMO_MODE) return
  updateProfile({ landingJob: '产品经理', lastRole: '产品' })
  seedDemoLedger()
  seedDemoMeetings()
  seedDemoWeekly()
  // 岗位拆解屏：直接展示一份完整示例拆解
  if (resultEl && resultEl.children.length === 0 && inputEl) {
    inputEl.value = '产品经理'
    demoJobBreakdown('产品经理')
  }
  // 会议纪要屏：直接展示一条示例纪要
  const meets = loadMeetings()
  if (meets.length && meetResultEl && meetResultEl.children.length === 0) {
    renderMeetingResult(meets[0])
  }
  renderOnboardingProgress()
}

seedDemoExperience()

// ===== 登陆进度矩形：渲染真实进度（旧顶部入口条已移除，保留函数供内部调用）=====
function renderEntryProgress() {
  const landing = loadLibrary().length > 0 || !!loadProfile().landingJob
  const ledger = loadTodos().length + loadProjects().length > 0
  const minutes = loadMeetings().length > 0
  const report = !!loadReports().find((r) => r.weekly)
  const done = [landing, ledger, minutes, report].filter(Boolean).length
  const pct = Math.round((done / 4) * 100)
  const fill = document.querySelector('.entry-portal-progress .onb-trunk-fill')
  if (fill) fill.style.width = pct + '%'
}
renderEntryProgress()

// 功能屏顶部入口条：点击跳转对应屏
document.querySelectorAll('.entry-portal[data-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-target')
    if (target) window.location.hash = target
  })
})
