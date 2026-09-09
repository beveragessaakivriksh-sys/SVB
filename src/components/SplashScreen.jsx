import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const BUBBLES = [0, 1, 2, 3, 4, 5];

export default function SplashScreen() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (sessionStorage.getItem("svb_splash_seen")) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => {
      setShow(false);
      sessionStorage.setItem("svb_splash_seen", "1");
    }, 2400);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Cola glass bottle */}
          <div className="relative h-52 w-24">
            {/* cap */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 h-2.5 w-8 rounded-sm bg-red-700" />
            {/* neck */}
            <div className="absolute left-1/2 top-2.5 -translate-x-1/2 h-6 w-5 rounded-t-sm border-2 border-amber-200/60 bg-amber-50/5" />
            {/* shoulder + body */}
            <div className="absolute bottom-0 left-0 right-0 top-8 overflow-hidden rounded-b-[2.2rem] rounded-t-xl border-2 border-amber-200/60 bg-white/5">
              {/* cola liquid fill */}
              <motion.div
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#2b1600] via-[#4a2200] to-[#6b3a12]"
                initial={{ height: "0%" }}
                animate={{ height: "90%" }}
                transition={{ duration: 1.8, ease: "easeOut" }}
              >
                {/* bubbles inside the cola */}
                {BUBBLES.map((b) => (
                  <motion.span
                    key={b}
                    className="absolute rounded-full bg-amber-50/70"
                    style={{ width: 4 + (b % 3) * 2, height: 4 + (b % 3) * 2, left: `${12 + b * 13}%` }}
                    initial={{ y: 0, opacity: 0 }}
                    animate={{ y: -150, opacity: [0, 0.85, 0] }}
                    transition={{ duration: 1.1 + (b % 3) * 0.4, repeat: Infinity, delay: b * 0.18, ease: "easeIn" }}
                  />
                ))}
              </motion.div>
              {/* glass shine */}
              <div className="absolute left-1.5 top-2 bottom-2 w-1.5 rounded-full bg-white/15" />
            </div>
          </div>

          {/* bubbles bubbling out over the neck */}
          {BUBBLES.slice(0, 4).map((b) => (
            <motion.span
              key={`top-${b}`}
              className="absolute rounded-full bg-amber-200/80"
              style={{ width: 5 + (b % 2) * 2, height: 5 + (b % 2) * 2, left: `calc(50% - 10px + ${b * 7}px)`, top: "30%" }}
              initial={{ y: 0, opacity: 0 }}
              animate={{ y: -40, opacity: [0, 0.9, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: b * 0.25 }}
            />
          ))}

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-6 text-5xl font-extrabold tracking-tight text-emerald-400"
          >
            SVB
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mt-2 text-sm text-emerald-200/70"
          >
            Saaki Vriksh Beverages
          </motion.p>

          <div className="mt-6 h-1 w-40 overflow-hidden rounded-full bg-white/20">
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
              className="h-full w-1/2 rounded-full bg-emerald-400"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}