import { createRoot } from 'react-dom/client'
import { PrismaHero } from '@/components/ui/prisma-hero'
import { FloatingNav } from '@/components/ui/floating-nav'
import './hero.css'

// 把 Hero + 全站浮窗导航一起挂到 #prisma-hero-root：
// - PrismaHero 是首屏可视内容，h-screen 撑满
// - FloatingNav 用 position: fixed + z-50，跨所有屏持续可见、可拖拽 / 锁定
const container = document.getElementById('prisma-hero-root')
if (container) {
  createRoot(container).render(
    <>
      <PrismaHero />
      <FloatingNav />
    </>,
  )
}
