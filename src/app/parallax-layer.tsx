"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

type ParallaxLayerProps = {
  amount?: number;
  children: ReactNode;
  className?: string;
  direction?: "foreground" | "background";
};

export function ParallaxLayer({
  amount = 24,
  children,
  className,
  direction = "foreground",
}: ParallaxLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const distance = amount / 2;
  const start = direction === "background" ? -distance : distance;
  const end = -start;
  const rawY = useTransform(scrollYProgress, [0, 1], [start, end]);
  const y = useSpring(rawY, {
    damping: 30,
    mass: 0.25,
    stiffness: 130,
  });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      style={{ y: shouldReduceMotion ? 0 : y }}
    >
      {children}
    </motion.div>
  );
}
