import { motion, useInView } from "framer-motion";
import { useRef } from "react";
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
  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // 直接滚到目标屏的真实顶部，让上一屏（hero）完全离开视口，避免底部残留
    const rect = el.getBoundingClientRect();
    const targetY = rect.top + window.scrollY;
    window.scrollTo({ top: targetY, behavior: "smooth" });
  };

  return (
    <section className="h-screen w-full">
      <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">
        
        {/* Background video */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4"
        />

        {/* Noise overlay */}
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />

        {/* Gradient overlay：底部渐隐为纯黑，与下方 screen-2 的纯黑背景无缝衔接，无可见边界 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />

        {/* 全站导航已抽到 FloatingNav 组件（独立于 hero，可拖拽 / 锁定） */}

        {/* Hero content */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 sm:px-6 sm:pb-10 md:px-10 md:pb-14 lg:pb-20">
          <div className="grid grid-cols-12 items-end gap-4">
            
            <div className="col-span-12 lg:col-span-8">
              <h1
                className="font-medium leading-[0.85] tracking-[-0.07em] text-[26vw] sm:text-[24vw] md:text-[22vw] lg:text-[20vw] xl:text-[19vw] 2xl:text-[20vw]"
                style={{ color: "#E1E0CC" }}
              >
                <WordsPullUp text="登陆岛" showAsterisk />
              </h1>
            </div>

            <div className="col-span-12 flex flex-col items-center gap-5 pb-6 text-center lg:col-span-4 lg:pb-10">
              
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="text-xs text-primary/70 sm:text-sm md:text-base"
                style={{ lineHeight: 1.2 }}
              >
               “ 嘿，别茫了，快来登陆岛，把陌生的海域走成自己的岛。”
              </motion.p>

              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => scrollToId("screen-2")}
                className="inline-flex items-center justify-center self-center rounded-full border border-white/15 bg-black/30 px-10 py-2.5 text-xl font-semibold backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/45 sm:px-14 sm:py-3 sm:text-2xl"
                style={{ color: "#E1E0CC" }}
              >
                登岛！
              </motion.button>

            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export { PrismaHero }
