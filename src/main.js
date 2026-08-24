import './style.css'
import systemPrompt from './prompt.txt?raw'
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
