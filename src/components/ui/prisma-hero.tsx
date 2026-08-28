import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type React from "react";
interface WordsPullUpProps {
  text: string;
  className?: string;
  showAsterisk?: boolean;
  style?: React.CSSProperties;
}

export const WordsPullUp = ({ text, className = "", showAsterisk = false, style }: WordsPullUpProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const words = text.split(" ");

  return (
    <div ref={ref} className={`inline-flex flex-wrap ${className}`} style={style}>
      {words.map((word, i) => {
        const isLast = i === words.length - 1;
        return (
          <motion.span
            key={i}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block relative"
            style={{ marginRight: isLast ? 0 : "0.25em" }}
          >
            {word}
            {showAsterisk && isLast && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
};

/* ---------------- WordsPullUpMultiStyle ---------------- */
interface Segment {
  text: string;
  className?: string;
}

interface WordsPullUpMultiStyleProps {
  segments: Segment[];
  className?: string;
  style?: React.CSSProperties;
}

export const WordsPullUpMultiStyle = ({ segments, className = "", style }: WordsPullUpMultiStyleProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

  const words: { word: string; className?: string }[] = [];
  segments.forEach((seg) => {
    seg.text.split(" ").forEach((w) => {
      if (w) words.push({ word: w, className: seg.className });
    });
  });

  return (
    <div ref={ref} className={`inline-flex flex-wrap justify-center ${className}`} style={style}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ y: 20, opacity: 0 }}
          animate={isInView ? { y: 0, opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className={`inline-block ${w.className ?? ""}`}
          style={{ marginRight: "0.25em" }}
        >
          {w.word}
        </motion.span>
      ))}
    </div>
  );
};

/* ---------------- Hero ---------------- */

const PrismaHero = () => {
  // 「登岛」进入 App 视图并定位到岗位拆解屏
  const enterApp = () => {
    window.location.hash = '#screen-3'
  }

  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)

  // 带 cache-busting 的资源路径，强制微信/浏览器刷新缓存
  const BASE_URL = import.meta.env.BASE_URL
  const POSTER_URL = `${BASE_URL}hero-poster.webp?v=2`
  const POSTER_FALLBACK_URL = `${BASE_URL}hero-poster.png?v=2`
  const VIDEO_URL = `${BASE_URL}hero-bg.mp4?v=2`

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const markReady = () => setVideoReady(true)

    // 务必在调用 play 前显式静音，部分浏览器据此放行自动播放
    const tryPlay = () => {
      if (!v) return
      v.muted = true
      const p = v.play()
      if (p && typeof p.catch === 'function') {
        p.then(markReady).catch(() => {})
      } else {
        markReady()
      }
    }

    tryPlay()
    v.addEventListener('canplay', tryPlay)
    v.addEventListener('playing', markReady)
    v.addEventListener('loadeddata', () => {
      if (v.currentTime > 0.05) markReady()
    })
    // 若约 3.5 秒内仍未开始播放（弱网/微信拦截自动播放），保持海报兜底，不再执着尝试
    const failTimer = window.setTimeout(() => {
      if (!v || v.paused || v.currentTime <= 0.1) setVideoReady(false)
    }, 3500)

    // 首次用户交互（触摸/点击）时再尝试一次播放——绕开移动端自动播放限制
    const onFirstInteract = () => {
      if (!v || !v.paused) return
      tryPlay()
    }
    window.addEventListener('touchstart', onFirstInteract, { once: true, passive: true })
    window.addEventListener('click', onFirstInteract, { once: true })

    return () => {
      window.clearTimeout(failTimer)
      if (!v) return
      v.removeEventListener('canplay', tryPlay)
      v.removeEventListener('playing', markReady)
      v.removeEventListener('loadeddata', markReady)
      window.removeEventListener('touchstart', onFirstInteract)
      window.removeEventListener('click', onFirstInteract)
    }
  }, [])

  return (
    <section id="screen-1" className="screen prisma-hero-screen h-screen w-full">
      <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">

        {/* 第 0 层：纯 CSS 生成的暗色星空/海面纹理兜底，不依赖任何图片资源，
            即使网络完全中断、图片全部失败，首屏也绝不黑屏。 */}
        <div
          className="absolute inset-0 z-0 bg-[#050505]"
          style={{
            background: `
              radial-gradient(ellipse at 20% 30%, rgba(225,224,204,0.12) 0%, transparent 55%),
              radial-gradient(ellipse at 80% 70%, rgba(225,224,204,0.08) 0%, transparent 50%),
              linear-gradient(135deg, #0a0a0a 0%, #050505 40%, #0c0c0c 100%)
            `,
          }}
        />

        {/* 第 1 层：CSS background-image 海报兜底（极小体积 webp，微信/弱网友好）。 */}
        <div
          className="absolute inset-0 z-0 bg-[#050505]"
          style={{
            backgroundImage: `url("${POSTER_URL}"), url("${POSTER_FALLBACK_URL}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(rgba(5,5,5,0.32), rgba(5,5,5,0.58))' }}
          />
        </div>

        {/* 第 2 层：<img> 高清海报，加载成功则盖在 CSS 背景之上，失败时自动 fallback 到 PNG。 */}
        <img
          src={POSTER_URL}
          alt=""
          className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-700 ${posterFailed ? 'opacity-0' : 'opacity-100'}`}
          onError={(e) => {
            // 如果 webp 失败（极少数旧内核），尝试 PNG fallback
            const img = e.currentTarget
            if (img.src !== POSTER_FALLBACK_URL) {
              img.src = POSTER_FALLBACK_URL
            } else {
              setPosterFailed(true)
            }
          }}
        />

        {/* 第 3 层：视频，真正开始播放后再淡入盖住海报 */}
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={POSTER_URL}
          className={`absolute inset-0 z-[3] h-full w-full object-cover transition-opacity duration-700 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
          src={VIDEO_URL}
        />

        {/* Noise overlay */}
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />

        {/* Gradient overlay：底部渐隐为纯黑，与下方 screen-2 的纯黑背景无缝衔接，无可见边界 */}
        <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-black/30 via-transparent to-black" />

        {/* 左上角品牌名：DengluDao，米白色，18px */}
        <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6 md:left-10 md:top-10">
          <span
            className="text-[18px] font-bold tracking-[0.14em]"
            style={{ color: "rgba(225, 224, 204, 0.95)", fontFamily: "Inter, sans-serif" }}
          >
            DengluDao
          </span>
        </div>

        {/* 屏幕居中主标语 */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-full -translate-x-1/2 -translate-y-1/2 px-4 text-center"
        >
          <motion.p
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="text-[40px] font-semibold leading-tight sm:text-[56px] md:text-[80px]"
            style={{ color: "rgba(225, 224, 204, 0.95)", textShadow: "0 6px 32px rgba(0,0,0,0.5)" }}
          >
            把陌生的海域走成自己的岛
          </motion.p>
        </div>

        {/* 全站导航已抽到 FloatingNav 组件（独立于 hero，可拖拽 / 锁定） */}

        {/* Hero content：slogan + 登岛按钮水平居中 */}
        <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-6 sm:px-6 sm:pb-10 md:px-10 md:pb-14 lg:pb-20">
          <div className="flex flex-col items-center gap-5 pb-6 text-center lg:pb-10">
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="text-xs text-primary/70 sm:text-sm md:text-base"
              style={{ lineHeight: 1.2 }}
            >
             “ 嘿，别茫了，一起上岛看看！”
            </motion.p>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              <button
                onClick={enterApp}
                className="inline-flex items-center justify-center rounded-full border border-[#E1E0CC]/30 bg-[#E1E0CC]/15 px-10 py-2.5 text-lg font-semibold text-[rgba(225,224,204,0.7)] backdrop-blur-md transition-all hover:bg-[#E1E0CC]/25 hover:shadow-[0_8px_32px_rgba(225,224,204,0.18)] sm:px-12 sm:text-xl"
              >
                登岛
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export { PrismaHero }
