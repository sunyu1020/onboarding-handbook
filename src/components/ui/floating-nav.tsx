import { useEffect, useState } from "react";
import { navItems } from "./nav-items";

const NavIcon = ({ d, className = "" }: { d: string; className?: string }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const FloatingNav = () => {
  const [activeId, setActiveId] = useState<string>(() =>
    window.location.hash.replace("#", ""),
  )

  // 根据当前 hash 高亮对应的菜单项（不再用滚动监听）
  useEffect(() => {
    const onHash = () => setActiveId(window.location.hash.replace("#", ""))
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, []);

  const goTo = (id: string) => {
    if (id === "top") {
      // 返回落地页（首屏独立页面）
      window.location.hash = ""
      return
    }
    // 切换功能视图：通过 hash 触发 AppShell 重新挂载对应屏
    window.location.hash = id
  }

  const openFavDrawer = () => {
    window.dispatchEvent(new CustomEvent("open-fav-drawer"))
  }

  const itemBase =
    "flex flex-col items-center justify-center gap-1 rounded-xl border-0 bg-transparent transition-all !no-underline";
  const itemInactive = "!text-[rgba(225,224,204,0.50)] hover:bg-[rgba(225,224,204,0.08)] hover:!text-[rgba(225,224,204,0.85)]";
  const itemActive =
    "bg-[rgba(225,224,204,0.16)] !text-[#E1E0CC] shadow-[0_0_18px_rgba(225,224,204,0.14)]";

  // 收藏入口：无外侧方框，仅图标 + 文字
  const favBase =
    "flex flex-col items-center justify-center gap-1 border-0 bg-transparent transition-colors !no-underline text-[rgba(225,224,204,0.50)] hover:text-[rgba(225,224,204,0.9)]";
  const aboutBase =
    "flex flex-col items-center justify-center gap-1 border-0 bg-transparent transition-all !no-underline";
  const aboutInactive = "!text-[rgba(225,224,204,0.50)] hover:bg-[rgba(225,224,204,0.08)] hover:!text-[rgba(225,224,204,0.85)]";
  const aboutActive = "bg-[rgba(225,224,204,0.16)] !text-[#E1E0CC] shadow-[0_0_18px_rgba(225,224,204,0.14)]";

  const goAbout = () => {
    window.location.hash = "screen-8";
  };
  const aboutIcon = "M3 19c3-3.5 7-5 9-5s6 1.5 9 5 M12 14c-2.2 0-4-1.6-4.7-4.2C7.9 7 9.8 5 12 5s4.1 2 4.7 4.8C16 12.4 14.2 14 12 14z M12 14v-4";

  const islandLogo = (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true" className="text-[#E1E0CC]">
      {/* 海浪线：下方一条模仿海浪的线 */}
      <path d="M4 33.5c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0 5-2.6 7.5 0 5 2.6 7.5 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      {/* 小岛：简笔画圆顶土丘（线稿） */}
      <path d="M11 33c0-4 4-9 9-9s9 5 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* 旗杆 + 旗子：插在岛顶 */}
      <path d="M20 24V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 11.5l6.5 3-6.5 3z" fill="currentColor" />
    </svg>
  );

  return (
    <>
      {/* 桌面端：左侧等高侧栏（仅在 App 视图渲染，始终可见） */}
      <nav
        className="fixed left-0 top-0 z-50 hidden h-screen w-[92px] flex-col items-center border-r border-[rgba(225,224,204,0.10)] bg-black/92 pt-10 backdrop-blur-xl md:flex"
        aria-label="主导航"
      >
        {/* Logo（米色岛屿简笔，无外框，与 screen-3 登陆进度卡片对齐） */}
        <button
          type="button"
          onClick={() => goTo("top")}
          className="mt-16 mb-8 flex flex-col items-center gap-1.5 border-0 bg-transparent transition-opacity hover:opacity-80"
          aria-label="返回首屏"
        >
          {islandLogo}
          <span className="text-[11px] font-medium tracking-widest text-[rgba(225,224,204,0.55)]">
            登陆岛
          </span>
        </button>

        {/* 功能入口 */}
        <div className="flex w-full flex-1 flex-col items-center gap-1.5 px-2">
          {navItems.map((item) => {
            const active = activeId === item.target;
            return (
              <a
                key={item.target}
                href={`#${item.target}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(item.target);
                }}
                className={`${itemBase} w-full px-1 py-3 ${active ? itemActive : itemInactive}`}
                title={item.label}
              >
                <NavIcon d={item.icon} />
                <span className="text-[11px] font-medium leading-tight">{item.label}</span>
              </a>
            );
          })}
        </div>

        {/* 收藏入口：无外侧方框 */}
        <button
          type="button"
          onClick={openFavDrawer}
          title="我的收藏"
          className={`${favBase} w-full px-1 py-3`}
        >
          <NavIcon d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
          <span className="text-[11px] font-medium leading-tight">收藏</span>
        </button>

        {/* 关于登陆岛入口：收藏下方，点开关于/初衷/数据管理模块 */}
        <button
          type="button"
          onClick={goAbout}
          title="关于登陆岛"
          className={`${aboutBase} w-full px-1 py-3 ${activeId === "screen-8" ? aboutActive : aboutInactive}`}
        >
          <NavIcon d={aboutIcon} />
          <span className="text-[11px] font-medium leading-tight">关于</span>
        </button>
      </nav>

      {/* 移动端：底部图标栏（仅在 App 视图渲染，始终可见、固定到底部） */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-[100] flex h-[68px] items-center justify-around border-t border-[rgba(225,224,204,0.10)] bg-black/92 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl will-change-transform md:hidden"
        style={{ transform: 'translateZ(0)' }}
        aria-label="主导航"
      >
        {navItems.map((item) => {
          const active = activeId === item.target;
          return (
            <a
              key={item.target}
              href={`#${item.target}`}
              onClick={(e) => {
                e.preventDefault();
                goTo(item.target);
              }}
              className={`${itemBase} min-w-[52px] px-2 py-1.5 ${active ? itemActive : itemInactive}`}
              title={item.label}
            >
              <NavIcon d={item.icon} className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </a>
          );
        })}
        <button
          type="button"
          onClick={openFavDrawer}
          title="我的收藏"
          className={`${favBase} min-w-[52px] px-2 py-1.5`}
        >
          <NavIcon d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-tight">收藏</span>
        </button>
        <button
          type="button"
          onClick={goAbout}
          title="关于登陆岛"
          className={`${aboutBase} min-w-[52px] px-2 py-1.5 ${activeId === "screen-8" ? aboutActive : aboutInactive}`}
        >
          <NavIcon d={aboutIcon} className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-tight">关于</span>
        </button>
      </nav>
    </>
  );
};

export { FloatingNav };
