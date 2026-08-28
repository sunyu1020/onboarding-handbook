import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PrismaHero } from '@/components/ui/prisma-hero'
import { FloatingNav } from '@/components/ui/floating-nav'
import './hero.css'

// 屏 → 所属功能视图：岗位拆解 / 工作台(含会议纪要+周报) / 开挂室 / 关于登陆岛
const SCREEN_VIEW: Record<string, 'job' | 'workbench' | 'room' | 'about'> = {
  'screen-3': 'job',
  'screen-2': 'workbench',
  'screen-5': 'workbench',
  'screen-6': 'workbench',
  'screen-7': 'room',
  'screen-8': 'about',
}

type ViewId = 'landing' | 'job' | 'workbench' | 'room' | 'about'

const parseHash = (hash: string): { view: ViewId; target: string } => {
  const id = hash.replace('#', '')
  if (!id || !(id in SCREEN_VIEW)) return { view: 'landing', target: '' }
  return { view: SCREEN_VIEW[id], target: id }
}

const AppShell = () => {
  const [hash, setHash] = useState<string>(() => window.location.hash || '')

  // 监听 hash 变化切换视图
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 根据 hash 决定显示哪个功能视图、隐藏其余屏，并定位到目标屏
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return

    const { view, target } = parseHash(hash)

    if (view === 'landing') {
      main.removeAttribute('data-view')
      document.body.style.overflow = 'hidden'
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    main.setAttribute('data-view', view)
    document.body.style.overflow = ''

    const el = target ? document.getElementById(target) : null
    requestAnimationFrame(() => {
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [hash])

  const isLanding = parseHash(hash).view === 'landing'

  return (
    <>
      <PrismaHero />
      {!isLanding && <FloatingNav />}
    </>
  )
}

const container = document.getElementById('prisma-hero-root')
if (container) {
  createRoot(container).render(<AppShell />)
}
