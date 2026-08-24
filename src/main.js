import './style.css'
import systemPrompt from './prompt.txt?raw'
import todoParsePromptRaw from './prompt-todo-parse.txt?raw'
import jobsData from '../data/jobs.json'

// ===== 常量 =====
// systemPrompt 逐字复制自 prompt-岗位拆解.md「System Prompt」代码块（v2.1 定稿，一字不改）
const API_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || ''
const LS_KEY = 'job_library' // AI 生成收藏（存完整数据）
const PRESET_FAV_KEY = 'preset_favorites' // 预置岗位收藏（只存 id，数据仍读 jobs.json）
const THEME_KEY = 'theme_preview'
const COLLAPSED_COUNT = 9 // 岗位库收起时展示 9 个 + 「查看更多」格

// 8 个结果模块，渲染顺序严格按任务表（oneLineTruth 单独大字渲染，不在此列）
const MODULES = [
  { key: 'dailyWork', title: '日常在干什么', type: 'list' },
  { key: 'kpi', title: '考核怎么算', type: 'list' },
  { key: 'keyCompetencies', title: '关键能力', type: 'tags' },
  { key: 'firstMonthPitfalls', title: '第一个月的坑', type: 'list' },
  { key: 'collaboration', title: '打交道地图', type: 'collab' },
  { key: 'week1Checklist', title: '第一周清单', type: 'checklist' },
  { key: 'interviewSecrets', title: '面试内行话', type: 'list' },
]

// HTTP 状态码 → 人话
const ERROR_MSGS = {
  401: 'API Key 无效：请检查 .env 里的 VITE_DEEPSEEK_API_KEY 是否填写正确，改完刷新页面再试',
  402: 'DeepSeek 账户额度不足：到 platform.deepseek.com 充值后再试',
  429: '请求太频繁：稍等十几秒再试一次',
}

// ===== DOM =====
const $ = (id) => document.getElementById(id)
const inputEl = $('job-input')
const generateBtn = $('generate-btn')
const statusEl = $('status-area')
const resultEl = $('result-area')
const presetGridEl = $('preset-grid')
const favGridEl = $('fav-grid')
const favEmptyEl = $('fav-empty')

let lastInput = '' // 当前这次输入，供重试按钮复用
let generating = false
let presetExpanded = false // 岗位库是否已展开

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

// ===== 配色切换（临时，选定后删除） =====
function initThemeSwitcher() {
  document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'blue'
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

  if (!API_KEY) {
    renderKeyGuide()
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
          { role: 'user', content: `岗位：${name}。宁可写满也不要提前收工` },
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
    generateBtn.textContent = '拆解这个岗位'
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

// ===== 结果渲染（8 模块） =====
function renderResult(job, { favoritable = false, preset = false } = {}, target = resultEl) {
  target.innerHTML = ''
  const wrap = el('div', 'result-wrap')

  // 头部：岗位名 + meta + 收藏按钮
  const head = el('div', 'result-head')
  const titleBox = el('div', 'title-box')
  titleBox.append(el('h2', 'result-job-name', preset ? job.name : (job.jobName || job.name)))
  const meta = el('div', 'result-meta')
  if (preset) {
    if (job.category) meta.append(el('span', 'chip', job.category))
    if (job.verifiedBy) meta.append(el('span', 'chip chip-ghost', job.verifiedBy))
  } else {
    meta.append(el('span', 'chip', job.verifiedBy || 'AI 生成'))
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

  // 2-8 模块卡片
  const grid = el('div', 'modules-grid')
  for (const m of MODULES) {
    const items = Array.isArray(job[m.key]) ? job[m.key] : []
    if (!items.length) continue
    const card = el('section', 'module-card')
    const headBtn = el('button', 'module-head')
    headBtn.type = 'button'
    headBtn.append(el('span', 'module-title', m.title), el('span', 'module-count', String(items.length)))
    headBtn.addEventListener('click', () => card.classList.toggle('collapsed'))
    const collapse = el('div', 'module-collapse')
    const body = el('div', 'module-body')
    if (m.type === 'tags') {
      const tagGrid = el('div', 'tag-grid')
      for (const it of items) {
        const [name, desc] = splitPair(it)
        const tag = el('div', 'tag-card')
        if (name) tag.append(el('strong', 'tag-name', name))
        if (desc) tag.append(el('span', 'tag-desc', desc))
        tagGrid.append(tag)
      }
      body.append(tagGrid)
    } else if (m.type === 'checklist') {
      const ul = el('ul', 'module-list')
      for (const it of items) {
        const li = el('li')
        const label = el('label', 'check-item')
        const cb = el('input')
        cb.type = 'checkbox'
        // 纯展示：点击可勾选，但不持久化
        label.append(cb, el('span', 'check-text', it))
        li.append(label)
        ul.append(li)
      }
      body.append(ul)
    } else {
      const ul = el('ul', 'module-list')
      for (const it of items) {
        const li = el('li')
        if (m.type === 'collab') {
          const [role, desc] = splitPair(it)
          if (role) li.append(el('strong', 'collab-role', role + '：'))
          li.append(el('span', '', desc || it))
        } else {
          li.append(el('span', '', it))
        }
        ul.append(li)
      }
      body.append(ul)
    }
    collapse.append(body)
    card.append(headBtn, collapse)
    grid.append(card)
  }
  wrap.append(grid)
  target.append(wrap)
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
  if (favBtn) {
    favBtn.textContent = '已收藏 ✓'
    favBtn.disabled = true
  }
}

// 一个岗位正方形：名称 + 右上角 ☆
function jobSquare(job, { preset }) {
  const starred = preset ? getPresetFavorites().includes(job.id) : true
  const sq = el('div', 'job-square')
  const nameBtn = el('button', 'job-square-name', job.name)
  nameBtn.type = 'button'
  nameBtn.addEventListener('click', () => {
    renderResult(job, { preset })
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
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

// 岗位库网格：收起 9 + 查看更多；展开 29 + 收起
function renderPresetGrid(animate = false) {
  presetGridEl.innerHTML = ''
  const jobs = presetExpanded ? jobsData.jobs : jobsData.jobs.slice(0, COLLAPSED_COUNT)
  for (const job of jobs) {
    const sq = jobSquare(job, { preset: true })
    if (animate) sq.classList.add('reveal-item')
    presetGridEl.append(sq)
  }
  const more = el(
    'button',
    'job-more' + (presetExpanded ? ' collapse-mode' : ''),
    presetExpanded ? '收起' : '查看更多',
  )
  more.type = 'button'
  more.addEventListener('click', togglePresetExpand)
  presetGridEl.append(more)
}

function togglePresetExpand() {
  presetExpanded = !presetExpanded
  renderPresetGrid(presetExpanded)
  if (presetExpanded) attachReveal(presetGridEl)
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
  for (const job of presetFavs) favGridEl.append(jobSquare(job, { preset: true }))
  for (const entry of aiFavs) favGridEl.append(jobSquare(entry, { preset: false }))
}

// ===== 事件绑定与初始化 =====
generateBtn.addEventListener('click', generate)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generate()
})

initThemeSwitcher()
renderPresetGrid(false)
renderFavGrid()

// ===== 整体框架：导航显隐 / 汉堡菜单 / 锚点平滑滚动 / 当前屏高亮 =====
const navEl = $('top-nav')
const navLinksEl = $('nav-links')
const burgerBtn = $('nav-burger')

// 下滚隐藏、上滚渐显（页面顶部附近始终显示）
let lastScrollY = window.scrollY
window.addEventListener(
  'scroll',
  () => {
    const y = window.scrollY
    if (y > lastScrollY && y > 120) navEl.classList.add('nav-hidden')
    else navEl.classList.remove('nav-hidden')
    lastScrollY = y
  },
  { passive: true },
)

// 导航锚点平滑滚动
navLinksEl.querySelectorAll('.nav-link').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault()
    const target = document.getElementById(a.getAttribute('href').slice(1))
    if (target) target.scrollIntoView({ behavior: 'smooth' })
    navLinksEl.classList.remove('open')
    burgerBtn.setAttribute('aria-expanded', 'false')
  })
})

// 开场 CTA → 平滑滚动到第 2 屏
$('opening-cta').addEventListener('click', () => {
  $('screen-2').scrollIntoView({ behavior: 'smooth' })
})

// 移动端汉堡菜单
burgerBtn.addEventListener('click', () => {
  const open = navLinksEl.classList.toggle('open')
  burgerBtn.setAttribute('aria-expanded', String(open))
})

// 当前屏高亮（第 1/5/8 屏无对应锚点，滚动到它们时不亮）
const navHighlighter = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue
      document.querySelectorAll('.nav-link').forEach((a) => {
        a.classList.toggle('active', a.dataset.screen === en.target.id)
      })
    }
  },
  { rootMargin: '-40% 0px -55% 0px' },
)
document.querySelectorAll('.screen[id]').forEach((s) => navHighlighter.observe(s))

// ============================================================
// 第 2 屏：今日工作台
// ============================================================
// ===== localStorage key 清单 =====
// job_library        AI 生成收藏（第 3 屏，已有）
// preset_favorites   预置岗位收藏 id（第 3 屏，已有）
// theme_preview      配色预览（临时，已有）
// odb_todos          待办：{id,title,dueDate,priority,note,done,createdAt,doneAt}
// odb_activities     动态：{type,title,time}（最多保留 50 条）

// ===== 第 2 屏 DOM =====
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
const dashActListEl = $('dash-act-list')
const dashActEmptyEl = $('dash-act-empty')

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
  renderActivities()
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
  dashGreetingEl.textContent = g.hello
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

// ===== 粘贴排期 → AI 解析 =====
const SAMPLE_TEXT = `周三前把竞品分析发给王总，他说要在部门会上用
下周一例会要汇报进度，ppt还没开始做
回复采购部那封邮件，已经催了两遍
周五下班前交报销单，记得贴发票
今天下午3点和设计对需求，先把页面稿过一遍
mentor 让整理上周会议纪要，说下周二前给他`

async function parseTodos() {
  const text = dashInputEl.value.trim()
  if (!text) {
    dashInputEl.focus()
    return
  }
  if (parsing) return
  if (!API_KEY) {
    renderParseStatus('key')
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
          { role: 'system', content: todoParsePromptRaw.replace('{{TODAY}}', todayStr()) },
          { role: 'user', content: `今天是 ${todayStr()}。请整理以下工作文本：\n\n${text}` },
        ],
        temperature: 0.2,
        max_tokens: 1000,
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
    const list = Array.isArray(parsed.todos) ? parsed.todos : []
    if (!list.length) {
      renderParseStatus('empty', parsed.note || '')
      return
    }
    renderConfirmList(list)
  } catch (err) {
    renderParseStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    parsing = false
    dashParseBtn.disabled = false
    dashParseBtn.textContent = '解析'
  }
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
    retry.addEventListener('click', parseTodos)
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
  renderParseStatus('success', `已添加 ${added} 条待办`)
  logActivity('todo-add', `新增 ${added} 条待办`)
  refreshDashboard()
}

// ===== 四大统计卡片 =====
function refreshStats() {
  const todos = loadTodos()
  const today = todayStr()
  const monday = mondayStart()
  const active = todos.filter((t) => !t.done)
  const weekCreated = todos.filter((t) => t.createdAt >= monday.getTime())
  const weekDone = weekCreated.filter((t) => t.done).length
  const dueToday = active.filter((t) => t.dueDate === today).length
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today).length

  $('stat-progress-num').textContent = String(active.length)
  $('stat-progress-sub').textContent = `本周新增 ${weekCreated.length}`
  $('stat-todo-num').textContent = String(active.length)
  $('stat-todo-sub').textContent = `今日到期 ${dueToday}`
  $('stat-overdue-num').textContent = String(overdue)
  $('stat-overdue-card').classList.toggle('danger', overdue > 0)
  $('stat-overdue-sub').textContent = overdue > 0 ? '点击查看台账' : '暂无风险'

  // 本周完成度：手写 SVG 圆环
  const total = weekCreated.length
  const ratio = total === 0 ? 0 : weekDone / total
  const C = 2 * Math.PI * 26
  $('dash-ring-num').textContent = total === 0 ? '—' : `${Math.round(ratio * 100)}%`
  $('dash-ring-fg').setAttribute('stroke-dasharray', `${(ratio * C).toFixed(1)} ${C.toFixed(1)}`)
}

// ===== 待办列表 =====
function renderTodoList() {
  const todos = loadTodos()
  const today = todayStr()
  const filtered = todos.filter((t) => (todoFilter === 'all' ? true : todoFilter === 'done' ? t.done : !t.done))
  dashTodoListEl.innerHTML = ''
  dashTodoEmptyEl.hidden = filtered.length > 0
  dashTodoEmptyEl.textContent =
    todos.length === 0 ? '还没有待办。把上面的工作排期粘贴进来，AI 帮你整理成清单' : '这个筛选下没有待办'
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
    if (dayTodos.length) {
      const hasHigh = dayTodos.some((t) => !t.done && t.priority === '高')
      cell.append(el('span', 'dash-cal-dot' + (hasHigh ? ' high' : '')))
      cell.addEventListener('click', () => toggleCalPopup(key, dayTodos))
    }
    dashCalGridEl.append(cell)
  }
  hideCalPopup()
}

function calDateKey(day) {
  return `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toggleCalPopup(key, dayTodos) {
  if (calPopupKey === key && !dashCalPopEl.hidden) {
    hideCalPopup()
    return
  }
  calPopupKey = key
  const undone = dayTodos.filter((t) => !t.done)
  dashCalPopEl.innerHTML = ''
  dashCalPopEl.append(
    el('div', 'dash-cal-pop-title', `${calMonth + 1} 月 ${parseInt(key.slice(8), 10)} 日 · ${dayTodos.length} 条待办，${undone.length} 条未完成`),
  )
  const ul = el('ul', 'dash-cal-pop-list')
  for (const t of dayTodos) {
    const li = el('li', t.done ? 'done' : '')
    li.append(el('span', 'dash-cal-pop-mark', t.done ? '✓' : '○'), el('span', '', t.title))
    ul.append(li)
  }
  dashCalPopEl.append(ul)
  dashCalPopEl.hidden = false
}

function hideCalPopup() {
  calPopupKey = ''
  dashCalPopEl.hidden = true
}

// ===== 最近动态 =====
const ACT_ICONS = { 'todo-add': '📝', 'todo-done': '✅', 'job-save': '⭐' }

function renderActivities() {
  const list = loadActivities().slice(0, 6)
  dashActListEl.innerHTML = ''
  dashActEmptyEl.hidden = list.length > 0
  for (const a of list) {
    const li = el('li', 'dash-act-item')
    li.append(
      el('span', 'dash-act-icon', ACT_ICONS[a.type] || '·'),
      el('span', 'dash-act-title', a.title),
      el('span', 'dash-act-time', relTime(a.time)),
    )
    dashActListEl.append(li)
  }
}

function relTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  const yesterday = new Date(Date.now() - 86400e3)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ===== 汇总刷新与事件绑定 =====
function refreshDashboard() {
  refreshStats()
  renderTodoList()
  renderCalendar()
  renderActivities()
}

dashParseBtn.addEventListener('click', parseTodos)
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
$('stat-overdue-card').addEventListener('click', () => {
  $('screen-4').scrollIntoView({ behavior: 'smooth' })
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
refreshDashboard()
