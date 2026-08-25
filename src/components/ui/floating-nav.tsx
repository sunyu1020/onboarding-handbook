import { useEffect, useRef, useState } from "react";
import { Lock, Unlock, GripHorizontal } from "lucide-react";
import { navItems } from "./nav-items";

const POS_KEY = "flnav_pos_v1";
const LOCK_KEY = "flnav_lock_v1";

// 距离视口边缘的最小保留像素，避免贴边
const SAFE = 10;
// hero 模式下导航停靠在顶部的留白（1:1 参考图：基本与 hero section 上沿贴合，仅留 4px 防切断阴影）
const HERO_TOP = 4;

interface Pos {
  x: number;
  y: number;
}

const clampPos = (p: Pos, w: number, h: number): Pos => ({
  x: Math.max(SAFE, Math.min(window.innerWidth - w - SAFE, p.x)),
  y: Math.max(SAFE, Math.min(window.innerHeight - h - SAFE, p.y)),
});

// 默认停靠：屏幕左侧空白处、垂直居中（竖向导航的“家”）
const defaultFloatPos = (w: number, h: number): Pos => {
  const x = SAFE + 6;
  const y = Math.max(SAFE, (window.innerHeight - h) / 2);
  return { x, y };
};

const FloatingNav = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // 浮窗（竖向停靠）位置，持久化
  const [floatPos, setFloatPos] = useState<Pos | null>(null);
  const [locked, setLocked] = useState(false);
  // 首屏（hero）是否在视口内：true → 导航停在 hero 顶部原位；false → 浮窗停靠左侧
  const [heroVisible, setHeroVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<string>("");
  const [ready, setReady] = useState(false);

  const moveRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, grabX: 0, grabY: 0 });

  // 首帧：读取持久化位置 / 默认左侧居中，测量后夹到视口内
  useEffect(() => {
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(POS_KEY) || "null");
      } catch {
        return null;
      }
    })() as Pos | null;

    const w = pillRef.current?.offsetWidth ?? 220;
    const h = pillRef.current?.offsetHeight ?? 320;
    setFloatPos(clampPos(saved ?? defaultFloatPos(w, h), w, h));
    setLocked(localStorage.getItem(LOCK_KEY) === "1");
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听首屏 #prisma-hero-root 是否在视口内，决定导航停在 hero 原位还是浮窗
  useEffect(() => {
    const hero = document.getElementById("prisma-hero-root");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          // 露出过半才算“在首屏”，避免滚动中间态闪烁
          setHeroVisible(en.isIntersecting && en.intersectionRatio > 0.5);
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // 视口变化：把浮窗位置夹回屏内（不影响锁定状态）
  useEffect(() => {
    const onResize = () => {
      setFloatPos((p) => {
        if (!p || !pillRef.current) return p;
        return clampPos(p, pillRef.current.offsetWidth, pillRef.current.offsetHeight);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 持久化
  useEffect(() => {
    if (floatPos) localStorage.setItem(POS_KEY, JSON.stringify(floatPos));
  }, [floatPos]);
  useEffect(() => {
    localStorage.setItem(LOCK_KEY, locked ? "1" : "0");
  }, [locked]);

  // 当前屏高亮
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = new Set(navItems.map((n) => n.target));
    const io = new IntersectionObserver(
      (entries) => {
        let best: { id: string; ratio: number } | null = null;
        for (const en of entries) {
          if (!ids.has(en.target.id)) continue;
          if (en.isIntersecting && (!best || en.intersectionRatio > best.ratio)) {
            best = { id: en.target.id, ratio: en.intersectionRatio };
          }
        }
        if (best) setActiveId(best.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    document.querySelectorAll(".screen[id]").forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // 计算当前应渲染的位置
  const w = pillRef.current?.offsetWidth ?? 0;
  const h = pillRef.current?.offsetHeight ?? 0;
  const heroPos: Pos = { x: Math.max(SAFE, (window.innerWidth - w) / 2), y: HERO_TOP };
  // 首屏（hero）强制顶部居中、忽略锁定；侧边（内容屏）才用可拖动的浮窗位置
  const rawFloat = floatPos ?? defaultFloatPos(w, h);
  const renderPos: Pos = heroVisible ? heroPos : clampPos(rawFloat, w, h);

  // 首屏原位态用横向胶囊；其它情况用竖向浮窗
  const isHeroLayout = heroVisible;

  // 仅在侧边（非首屏）才可拖动；首屏始终固定顶部居中
  const canDrag = !heroVisible;

  // ----- 拖拽 -----
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag || !floatPos) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    moveRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = moveRef.current;
    if (!m.active || !canDrag || !floatPos) return;
    if (!m.moved) {
      if (Math.abs(e.clientX - m.startX) > 4 || Math.abs(e.clientY - m.startY) > 4) {
        m.moved = true;
        setDragging(true);
      } else {
        return;
      }
    }
    const el = wrapRef.current;
    if (!el) return;
    setFloatPos({
      x: Math.max(SAFE, Math.min(window.innerWidth - el.offsetWidth - SAFE, e.clientX - m.grabX)),
      y: Math.max(SAFE, Math.min(window.innerHeight - el.offsetHeight - SAFE, e.clientY - m.grabY)),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    moveRef.current.active = false;
    if (dragging) setDragging(false);
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      moveRef.current.moved = false;
    }, 50);
  };

  // ----- 锚点跳转：滚到目标屏真实顶部，避免上一屏残留 -----
  const goTo = (id: string) => {
    if (moveRef.current.moved) return;
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({ top: rect.top + window.scrollY, behavior: "smooth" });
  };

  const cursor = locked ? "cursor-default" : canDrag ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default";

  return (
    <div
      ref={wrapRef}
      className={`fixed z-50 select-none ${cursor} ${dragging ? "transition-none" : ""}`}
      style={{
        left: renderPos.x,
        top: renderPos.y,
        touchAction: "none",
        opacity: ready ? 1 : 0,
        transition: dragging
          ? "none"
          : "left .45s cubic-bezier(.16,1,.3,1), top .45s cubic-bezier(.16,1,.3,1), opacity .25s ease",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={pillRef}
        className={
          isHeroLayout
            ? "flex items-center gap-5 rounded-2xl border border-white/15 bg-black/30 px-5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md sm:gap-7 sm:px-6 sm:py-3 md:gap-9 md:px-7 md:py-3"
            : "flex flex-col items-stretch gap-1 rounded-2xl border border-white/15 bg-black/30 px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md"
        }
        title={
          locked
            ? "已锁定，点击锁按钮解锁后可拖动"
            : heroVisible
              ? "首页原位导航（滚动到内容屏后可拖动）"
              : "按住导航可拖动到任意位置"
        }
      >
        {isHeroLayout ? (
          // ===== 首页原位：横向胶囊，5 项一行 =====
          navItems.map((item) => {
            const active = activeId === item.target;
            return (
              <a
                key={item.label}
                href={`#${item.target}`}
                onClick={(e) => {
                  if (moveRef.current.moved || dragging) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  goTo(item.target);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="no-underline whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-medium transition-colors sm:text-base md:text-lg"
                style={{
                  color: active ? "#FFFFFF" : "rgba(225, 224, 204, 0.85)",
                  textShadow: active ? "0 0 12px rgba(255,255,255,0.45)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "#E1E0CC";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "rgba(225, 224, 204, 0.85)";
                }}
              >
                {item.label}
              </a>
            );
          })
        ) : (
          // ===== 内容屏：竖向浮窗，带拖拽柄 + 锁按钮 =====
          <>
            <span
              aria-hidden="true"
              className={`flex items-center justify-center py-0.5 text-[10px] tracking-[2px] ${
                locked ? "text-white/25" : "text-white/55"
              }`}
            >
              <GripHorizontal size={14} />
            </span>

            {navItems.map((item) => {
              const active = activeId === item.target;
              return (
                <a
                  key={item.label}
                  href={`#${item.target}`}
                  onClick={(e) => {
                    if (moveRef.current.moved || dragging) {
                      e.preventDefault();
                      return;
                    }
                    e.preventDefault();
                    goTo(item.target);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="no-underline whitespace-nowrap rounded-lg px-4 py-1.5 text-center text-sm font-medium transition-colors sm:text-[15px]"
                  style={{
                    color: active ? "#FFFFFF" : "rgba(225, 224, 204, 0.82)",
                    textShadow: active ? "0 0 12px rgba(255,255,255,0.45)" : "none",
                    background: active ? "rgba(255,255,255,0.10)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = "#E1E0CC";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "rgba(225, 224, 204, 0.82)";
                  }}
                >
                  {item.label}
                </a>
              );
            })}

            <span className="mx-3 my-1 h-px bg-white/15" aria-hidden="true" />

            <button
              type="button"
              aria-label={locked ? "解锁导航位置" : "锁定导航位置"}
              aria-pressed={locked}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLocked((v) => !v);
              }}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                locked
                  ? "border-amber-300/50 bg-amber-300/15 text-amber-100 hover:bg-amber-300/25"
                  : "border-white/10 bg-white/5 text-white/85 hover:bg-white/15"
              }`}
              title={locked ? "已锁定：点击解锁后可拖动" : "未锁定：拖动导航到任意位置后点这里固定"}
            >
              {locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export { FloatingNav };
