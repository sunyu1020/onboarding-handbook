import './style.css'
import systemPrompt from './prompt.txt?raw'
import todoParsePromptRaw from './prompt-todo-parse.txt?raw'
import projectParsePromptRaw from './prompt-project-parse.txt?raw'
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
// odb_projects       项目台账：{id,name,stage,deadline,owner,risks,todoIds,createdAt,updatedAt}
// odb_meetings       会议纪要：{id,title,date,conclusions,actionItems,openQuestions,createdAt}（保留最近 20 条）
// odb_reports        周报：{id,weekStart,weekly,upward,createdAt}（保留最近 8 条）
// odb_book_status    书单阅读状态：{bookId: 'want'|'reading'|'read'}（books.json 的 status 仅为默认值）
// odb_dilemma_fav    困境收藏：困境 id 数组

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

// ============================================================
// 第 4 屏：项目台账
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

// ===== 第 4 屏 DOM =====
const projInputEl = $('proj-input')
const projParseBtn = $('proj-parse-btn')
const projSampleBtn = $('proj-sample-btn')
const projImportBtn = $('proj-import-btn')
const projParseStatusEl = $('proj-parse-status')
const projConfirmEl = $('proj-confirm-list')
const projImportPanelEl = $('proj-import-panel')
const projImportTodoListEl = $('proj-import-todo-list')
const projImportConfirmBtn = $('proj-import-confirm')
const projImportCloseBtn = $('proj-import-close')
const projImportMsgEl = $('proj-import-msg')
const projStageTabsEl = $('proj-stage-tabs')
const projOwnerFilterEl = $('proj-owner-filter')
const projSearchEl = $('proj-search')
const projListEl = $('proj-list')
const projEmptyEl = $('proj-empty')

let confirmProjects = [] // 整理后待确认列表
let projFilterStage = 'all'
let projParsing = false
let projImportChecked = new Set()

// 第 2 屏动态图标扩展（只新增键，不改第 2 屏逻辑）
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
}

// ===== 粘贴工作清单 → AI 整理 =====
const PROJ_SAMPLE_TEXT = `项目a 短视频脚本 8月30日前交脚本 张伟
项目A 拍摄 9月5号 张伟 人手不够可能延期
新品发布会物料 2026/9/15截止 李娜负责
品牌宣传片：初稿完了这周开始拍 王强 甲方场地没定有风险
公众号改版 下周五前上线 小周
项目a 剪辑 9月10日交付`

async function parseProjects() {
  const text = projInputEl.value.trim()
  if (!text) {
    projInputEl.focus()
    return
  }
  if (projParsing) return
  if (!API_KEY) {
    renderProjStatus('key')
    return
  }
  projParsing = true
  projParseBtn.disabled = true
  projParseBtn.textContent = '整理中…'
  renderProjStatus('loading')
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
          { role: 'system', content: projectParsePromptRaw.replace('{{TODAY}}', todayStr()) },
          { role: 'user', content: `今天是 ${todayStr()}。请整理以下工作清单：\n\n${text}` },
        ],
        temperature: 0.2,
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
    const list = Array.isArray(parsed.projects) ? parsed.projects : []
    if (!list.length) {
      renderProjStatus('empty', parsed.note || '')
      return
    }
    renderConfirmProjects(list)
  } catch (err) {
    renderProjStatus('error', err.name === 'TypeError' ? '网络异常，请检查网络后重试' : err.message)
  } finally {
    projParsing = false
    projParseBtn.disabled = false
    projParseBtn.textContent = '整理'
  }
}

function renderProjStatus(kind, msg = '') {
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
  renderProjStatus('success', `已添加 ${added} 个项目`)
  logActivity('proj-add', `新建 ${added} 个项目`)
  refreshProjects()
}

// ===== 从待办导入 =====
function openImportPanel() {
  const todos = loadTodos().filter((t) => !t.done)
  projImportChecked.clear()
  projImportMsgEl.innerHTML = ''
  projImportTodoListEl.innerHTML = ''
  if (!todos.length) {
    projImportTodoListEl.append(el('li', 'proj-import-empty', '没有未完成的待办可导入'))
    projImportConfirmBtn.disabled = true
  } else {
    for (const t of todos) {
      const li = el('li')
      const label = el('label', 'proj-import-todo')
      const cb = el('input')
      cb.type = 'checkbox'
      cb.value = t.id
      cb.addEventListener('change', () => {
        if (cb.checked) projImportChecked.add(t.id)
        else projImportChecked.delete(t.id)
      })
      label.append(cb, el('span', 'proj-import-todo-title', t.title))
      if (t.dueDate) label.append(el('span', 'proj-import-todo-due', t.dueDate))
      li.append(label)
      projImportTodoListEl.append(li)
    }
    projImportConfirmBtn.disabled = false
  }
  projImportPanelEl.hidden = false
}

function confirmImportTodos() {
  const todos = loadTodos()
  const projects = loadProjects()
  const now = Date.now()
  let added = 0
  const warns = []
  for (const tid of projImportChecked) {
    const t = todos.find((x) => x.id === tid)
    if (!t) continue
    const dup = projects.find((p) => (p.todoIds || []).includes(tid))
    if (dup) {
      warns.push(`该待办已关联项目『${dup.name}』：${t.title}`)
      continue
    }
    projects.unshift({
      id: 'p' + now + '-' + added,
      name: t.title,
      stage: 'plan',
      deadline: t.dueDate || null,
      owner: null,
      risks: [],
      todoIds: [tid],
      createdAt: now,
      updatedAt: now,
    })
    added++
  }
  saveProjects(projects)
  projImportMsgEl.innerHTML = ''
  if (added) {
    logActivity('proj-add', `从待办导入 ${added} 个项目`)
    projImportMsgEl.append(el('p', 'proj-import-ok', `已导入 ${added} 个待办为项目`))
  }
  for (const w of warns) projImportMsgEl.append(el('p', 'proj-import-warn', w))
  projImportChecked.clear()
  refreshProjects()
  // 刷新面板勾选状态
  for (const cb of projImportTodoListEl.querySelectorAll('input[type=checkbox]')) cb.checked = false
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
  projEmptyEl.textContent =
    projects.length === 0 ? '还没有项目。把工作清单粘贴进来，AI 帮你整理成台账' : '没有符合筛选条件的项目'
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

  // 5 段进度条：点击某段直接跳到该阶段
  const stageIdx = PROJECT_STAGES.findIndex((s) => s.key === p.stage)
  const bar = el('div', 'proj-stages')
  PROJECT_STAGES.forEach((s, i) => {
    const seg = el('button', 'proj-stage-seg' + (i < stageIdx ? ' passed' : i === stageIdx ? ' current' : ''), s.label)
    seg.type = 'button'
    seg.title = '点击设为「' + s.label + '」阶段'
    seg.addEventListener('click', () => updateProject(p.id, { stage: s.key }))
    bar.append(seg)
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
projParseBtn.addEventListener('click', parseProjects)
projSampleBtn.addEventListener('click', () => {
  projInputEl.value = PROJ_SAMPLE_TEXT
  projInputEl.focus()
})
projImportBtn.addEventListener('click', openImportPanel)
projImportCloseBtn.addEventListener('click', () => {
  projImportPanelEl.hidden = true
})
projImportConfirmBtn.addEventListener('click', confirmImportTodos)
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
  if (!API_KEY) {
    renderMeetStatus('key')
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
  actions.append(copyBtn, syncBtn)
  head.append(titleBox, actions)
  wrap.append(head)

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
  lines.push('—— 由「新人上手手册」整理')
  return lines.join('\n')
}

async function copyMeetingText(m) {
  const text = buildCopyText(m)
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制，可粘贴到群里')
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
    showToast(ok ? '已复制，可粘贴到群里' : '复制失败，请手动选择文本复制')
  }
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

// ===== 最近纪要（展开复用结果渲染，可删除） =====
function renderMeetHistory() {
  const list = loadMeetings()
  meetHistoryListEl.innerHTML = ''
  meetHistoryEmptyEl.hidden = list.length > 0
  for (const m of list) {
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
const repEditorMetaEl = $('rep-editor-meta')
const repCopyBtn = $('rep-copy-btn')
const repHistoryListEl = $('rep-history-list')
const repHistoryEmptyEl = $('rep-history-empty')
const repUpwardBtn = $('rep-upward-btn')
const repUpwardStatusEl = $('rep-upward-status')
const repUpwardEditorEl = $('rep-upward-editor')
const repUpwardCopyBtn = $('rep-upward-copy')

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

// ===== 统计条 =====
function refreshRepStats() {
  const snap = buildWeeklySnapshot()
  const hasData = loadTodos().length + loadProjects().length + loadMeetings().length > 0
  const C = 2 * Math.PI * 26
  $('rep-ring-num').textContent = hasData ? `${snap.completion}%` : '—'
  $('rep-ring-fg').setAttribute('stroke-dasharray', `${((snap.completion / 100) * C).toFixed(1)} ${C.toFixed(1)}`)
  $('rep-stat-done').textContent = String(snap.completed.length)
  $('rep-stat-overdue').textContent = String(snap.overdue.length)
  $('rep-stat-risks').textContent = String(snap.risks.length)
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
  if (!API_KEY) {
    renderRepStatus('key')
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
          { role: 'user', content: `本周数据快照：\n${JSON.stringify(snapshot)}\n请写周报。` },
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
    renderRepHistory()
    refreshRepStats()
    updateRepGenerateBtn()
    renderRepStatus('success', '周报已生成，可直接编辑后复制')
    logActivity('report-weekly', `生成周报：${snapshot.weekStart} 起的一周`)
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
  if (!API_KEY) {
    renderRepUpwardStatus('key')
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
          { role: 'user', content: `我的周报原文：\n${weeklyText}\n请改写。` },
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
    logActivity('report-upward', '生成向上汇报')
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

repCopyBtn.addEventListener('click', () => copyRepText(repEditorEl.value))
repUpwardCopyBtn.addEventListener('click', () => copyRepText(repUpwardEditorEl.value))
$('rep-goto-workbench').addEventListener('click', () => {
  $('screen-2').scrollIntoView({ behavior: 'smooth' })
})

// ===== 历史周报（按周倒序 8 条，点击加载回编辑区） =====
function renderRepHistory() {
  const list = loadReports()
  repHistoryListEl.innerHTML = ''
  repHistoryEmptyEl.hidden = list.length > 0
  for (const r of list) {
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
      repCopyBtn.hidden = !r.weekly
      repUpwardCopyBtn.hidden = !r.upward
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
renderRepHistory()
refreshRepStats()
updateRepGenerateBtn()

// ============================================================
// 第 7 屏：新人开挂室（书单 + 困境，纯本地，不调 AI）
// ============================================================
const BOOK_STATUS_KEY = 'odb_book_status' // {bookId: 'want'|'reading'|'read'}，books.json 的 status 仅为默认值
const DILEMMA_FAV_KEY = 'odb_dilemma_fav' // 困境 id 数组

// ===== 第 7 屏 DOM =====
const openTabsEl = $('open-tabs')
const openPanelBooksEl = $('open-panel-books')
const openPanelDilemmasEl = $('open-panel-dilemmas')
const openRoleFilterEl = $('open-role-filter')
const openStageFiltersEl = $('open-stage-filters')
const openBooksEl = $('open-books')
const openBooksEmptyEl = $('open-books-empty')
const openDilemmaInputEl = $('open-dilemma-input')
const openDilemmaTagsEl = $('open-dilemma-tags')
const openFavOnlyEl = $('open-fav-only')
const openDilemmaMatchEl = $('open-dilemma-match')
const openDilemmaDetailEl = $('open-dilemma-detail')
const openDrawerEl = $('open-drawer')
const openDrawerMaskEl = $('open-drawer-mask')
const openDrawerBodyEl = $('open-drawer-body')
const openDrawerCloseEl = $('open-drawer-close')

const PRIO_ORDER = { P0: 0, P1: 1, P2: 2 }
const STAGE_ORDER = { 入职前: 0, '入职1个月': 1, '入职3个月': 2 }
const DOT_LABELS = { want: '想读', reading: '在读', read: '已读' }
const PRIO_LABELS = { P0: 'P0 必读', P1: 'P1 进阶', P2: 'P2 拓展' }

let bookRoleFilter = 'all'
let bookStageFilter = 'all'
let selectedDilemmaId = null
let favOnly = false

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
  openBooksEl.innerHTML = ''
  openBooksEmptyEl.hidden = list.length > 0
  list.forEach((b, i) => {
    const card = el('div', 'open-book-card' + (i % 4 === 1 || i % 4 === 2 ? ' sink' : ''))
    card.append(el('div', 'open-book-cat', b.category))
    const cover = el('div', 'open-book-cover')
    cover.append(el('div', 'open-book-title', b.title), el('div', 'open-book-author', b.author))
    const status = statusMap[b.id] || b.status || 'want'
    const dot = el('button', 'open-book-dot dot-' + status, status === 'read' ? '✓' : '')
    dot.type = 'button'
    dot.title = `${DOT_LABELS[status]}（点击切换）`
    dot.setAttribute('aria-label', '切换阅读状态：' + DOT_LABELS[status])
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      cycleBookStatus(b)
    })
    card.append(cover, dot)
    card.addEventListener('click', () => openBookDrawer(b))
    openBooksEl.append(card)
  })
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

// ===== 书单抽屉 =====
function openBookDrawer(b) {
  openDrawerBodyEl.innerHTML = ''
  openDrawerBodyEl.append(el('div', 'open-drawer-title', b.title), el('div', 'open-drawer-author', b.author))
  const tags = el('div', 'open-drawer-tags')
  tags.append(el('span', 'open-drawer-tag', b.category), el('span', 'open-drawer-tag', PRIO_LABELS[b.priority] || b.priority))
  for (const r of b.forRoles || []) tags.append(el('span', 'open-drawer-tag', r))
  tags.append(el('span', 'open-drawer-tag', b.readingStage || ''))
  tags.append(el('span', 'open-drawer-tag open-drawer-tag-accent', DOT_LABELS[getBookStatus(b)]))
  openDrawerBodyEl.append(tags)
  const reasonBox = el('div', 'open-drawer-reason-box')
  reasonBox.append(el('div', 'open-drawer-reason-label', '推荐理由'), el('p', 'open-drawer-reason', b.reason))
  openDrawerBodyEl.append(reasonBox)
  const searchBtn = el('button', 'btn-primary open-drawer-search', '在线搜索')
  searchBtn.type = 'button'
  searchBtn.addEventListener('click', () => {
    window.open(`https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(b.title)}`, '_blank')
  })
  openDrawerBodyEl.append(searchBtn)
  openDrawerEl.hidden = false
  openDrawerMaskEl.hidden = false
  requestAnimationFrame(() => {
    openDrawerEl.classList.add('open')
    openDrawerMaskEl.classList.add('open')
  })
}

function closeBookDrawer() {
  openDrawerEl.classList.remove('open')
  openDrawerMaskEl.classList.remove('open')
  setTimeout(() => {
    openDrawerEl.hidden = true
    openDrawerMaskEl.hidden = true
  }, 300)
}

openDrawerCloseEl.addEventListener('click', closeBookDrawer)
openDrawerMaskEl.addEventListener('click', closeBookDrawer)

openRoleFilterEl.addEventListener('change', () => {
  bookRoleFilter = openRoleFilterEl.value
  renderBooks()
})
openStageFiltersEl.addEventListener('click', (e) => {
  const b = e.target.closest('.open-stage-btn')
  if (!b) return
  bookStageFilter = b.dataset.stage
  document.querySelectorAll('.open-stage-btn').forEach((x) => x.classList.toggle('active', x === b))
  renderBooks()
})

// ===== 困境 =====
function renderDilemmaTags() {
  const fav = loadDilemmaFav()
  const list = favOnly ? dilemmasData.dilemmas.filter((d) => fav.includes(d.id)) : dilemmasData.dilemmas
  openDilemmaTagsEl.innerHTML = ''
  if (!list.length) {
    openDilemmaTagsEl.append(el('span', 'open-tags-empty', '还没有收藏的困境'))
    return
  }
  for (const d of list) {
    const tag = el(
      'button',
      'open-dilemma-tag' + (d.id === selectedDilemmaId ? ' active' : ''),
      (fav.includes(d.id) ? '☆ ' : '') + d.title,
    )
    tag.type = 'button'
    tag.addEventListener('click', () => selectDilemma(d.id))
    openDilemmaTagsEl.append(tag)
  }
}

function selectDilemma(id) {
  selectedDilemmaId = id
  renderDilemmaTags()
  const d = dilemmasData.dilemmas.find((x) => x.id === id)
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
    const d = dilemmasData.dilemmas.find((x) => x.id === id)
    if (d) renderDilemmaDetail(d)
  }
}

openFavOnlyEl.addEventListener('change', () => {
  favOnly = openFavOnlyEl.checked
  renderDilemmaTags()
})

// 本地关键词匹配，不调任何 AI 接口
openDilemmaInputEl.addEventListener('input', () => {
  const kw = openDilemmaInputEl.value.trim()
  openDilemmaMatchEl.innerHTML = ''
  if (!kw) return
  const hits = dilemmasData.dilemmas.filter((d) => d.title.includes(kw))
  if (!hits.length) {
    openDilemmaMatchEl.append(el('p', 'open-match-empty', '没找到完全匹配的，试试点上面的标签，或换几个关键词'))
    return
  }
  for (const d of hits) {
    const btn = el('button', 'open-match-item', d.title)
    btn.type = 'button'
    btn.addEventListener('click', () => {
      selectDilemma(d.id)
      openDilemmaInputEl.value = ''
      openDilemmaMatchEl.innerHTML = ''
    })
    openDilemmaMatchEl.append(btn)
  }
})

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

// ===== v2 DOM =====
const jdRoleCardsEl = $('jd-role-cards')
const jdRoleNameBtn = $('jd-role-name-btn')
const jdRolePasteBtn = $('jd-role-jd-paste-btn')
const jdRoleOcrBtn = $('jd-role-jd-ocr-btn')
const jdPanelNameEl = $('jd-panel-name')
const jdPanelJdEl = $('jd-panel-jd')
const jdInputEl = $('jd-input')
const jdOcrFileEl = $('jd-ocr-file')
const jdParseBtn = $('jd-parse-btn')
const jdStatusEl = $('jd-status')
const jdResultEl = $('jd-result')
const jdChatEl = $('jd-chat')
const jdChatBoxEl = $('jd-chat-box')
const jdChatInputEl = $('jd-chat-input')
const jdChatSendEl = $('jd-chat-send')

let jdParsing = false
let jdChatMessages = [] // 对话历史只保留在内存，不落 localStorage
let jdChatSystem = '' // Prompt③ + 本次岗位地图 JSON
let jdChatBusy = false
let jdLastJobName = ''

// ===== 角色卡片：先选角色，再执行动作 =====
function setJdTab(tab) {
  document.querySelectorAll('.jd-role-card').forEach((c) => c.classList.toggle('active', c.dataset.role === tab))
  jdPanelNameEl.hidden = tab !== 'name'
  jdPanelJdEl.hidden = tab !== 'jd'
}

// 点卡片（非按钮区域）＝选择角色
jdRoleCardsEl.addEventListener('click', (e) => {
  const card = e.target.closest('.jd-role-card')
  if (!card || e.target.closest('button')) return
  setJdTab(card.dataset.role)
})

// 卡片内动作按钮：选择对应角色并触发动作
jdRoleNameBtn.addEventListener('click', () => {
  setJdTab('name')
  inputEl.focus()
})
jdRolePasteBtn.addEventListener('click', () => {
  setJdTab('jd')
  jdInputEl.focus()
})
jdRoleOcrBtn.addEventListener('click', () => {
  setJdTab('jd')
  jdOcrFileEl.click()
})

// ===== 截图提字（智谱 GLM-4V-Flash） =====
if (!ZHIPU_API_KEY) {
  jdRoleOcrBtn.disabled = true
  jdRoleOcrBtn.title = '需配置 VITE_ZHIPU_API_KEY'
}

jdOcrFileEl.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
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
    jdInputEl.value = text
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
jdParseBtn.addEventListener('click', parseJd)

async function parseJd() {
  const text = jdInputEl.value.trim()
  if (!text) {
    jdInputEl.focus()
    return
  }
  if (jdParsing) return
  if (!API_KEY) {
    renderJdStatus('key')
    return
  }
  jdParsing = true
  jdParseBtn.disabled = true
  jdParseBtn.textContent = '拆解中…'
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
    jdParseBtn.disabled = false
    jdParseBtn.textContent = '拆解这份 JD'
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
    card.append(el('div', 'jd-status-icon', '✅'), el('p', 'jd-status-text', '已提取截图文字，可修改后点「拆解这份 JD」'))
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
  jdResultEl.append(wrap)
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

async function sendJdChat(question) {
  const q = (question || jdChatInputEl.value).trim()
  if (!q || jdChatBusy) return
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
