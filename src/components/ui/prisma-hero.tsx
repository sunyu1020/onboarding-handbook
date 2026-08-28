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
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    // 务必在调用 play 前显式静音，部分浏览器据此放行自动播放
    const tryPlay = () => {
      v.muted = true
      const p = v.play()
      if (p && typeof p.catch === 'function') {
        // 播放成功则显示视频，失败则保持海报兜底
        p.then(() => setVideoFailed(false)).catch(() => {})
      }
    }

    tryPlay()
    v.addEventListener('canplay', tryPlay)
    const onError = () => setVideoFailed(true)
    v.addEventListener('error', onError)
    // 若约 3.5 秒内仍未开始播放（弱网/微信拦截自动播放），淡出 video 露出底层海报
    const failTimer = window.setTimeout(() => {
      if (v.paused && v.currentTime <= 0.1) setVideoFailed(true)
    }, 3500)

    // 首次用户交互（触摸/点击）时再尝试一次播放——绕开移动端自动播放限制
    const onFirstInteract = () => {
      if (v.paused) tryPlay()
    }
    window.addEventListener('touchstart', onFirstInteract, { once: true, passive: true })
    window.addEventListener('click', onFirstInteract, { once: true })

    return () => {
      window.clearTimeout(failTimer)
      v.removeEventListener('canplay', tryPlay)
      v.removeEventListener('error', onError)
      window.removeEventListener('touchstart', onFirstInteract)
      window.removeEventListener('click', onFirstInteract)
    }
  }, [])

  return (
    <section id="screen-1" className="screen prisma-hero-screen h-screen w-full">
      <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">

        {/* 备用背景层：以 AI 生成的海报图作为可靠背景（兼容移动端/无网/自动播放被拦截）。
            视频成功播放时会盖在它之上；失败时淡出 video，露出这层海报，永远不会是黑屏。 */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundColor: '#050505',
            backgroundImage:
              `linear-gradient(rgba(5,5,5,0.32), rgba(5,5,5,0.58)), url("${import.meta.env.BASE_URL}hero-poster.png")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />

        {/* Background video：加载失败或播放失败时透明降级，露出下方海报背景 */}
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={`${import.meta.env.BASE_URL}hero-poster.png`}
          className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-700 ${videoFailed ? 'opacity-0' : 'opacity-100'}`}
          src={`${import.meta.env.BASE_URL}hero-bg.mp4`}
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
