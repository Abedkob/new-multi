"use client";

import { motion } from "motion/react";

/**
 * Template `index.tsx` files are server components (no data fetching of their own, but no
 * "use client" either, so they stay zero-JS where nothing animates). `motion.div` etc. are
 * built lazily by a Proxy that must run in client code, so each element a template needs is
 * instantiated once here, in an actual "use client" module, and imported by name from there.
 */
export const MotionDiv = motion.div;
export const MotionSection = motion.section;
export const MotionHeader = motion.header;
export const MotionH1 = motion.h1;
export const MotionH2 = motion.h2;
export const MotionH3 = motion.h3;
export const MotionP = motion.p;
export const MotionUl = motion.ul;
export const MotionLi = motion.li;
export const MotionSpan = motion.span;
