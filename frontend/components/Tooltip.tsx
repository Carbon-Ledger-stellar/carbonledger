"use client";

import { useState, useRef, useEffect, useId } from "react";

interface TooltipProps {
  content: string;
  children: React.ReactElement;
}

export default function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [visible]);

  return (
    <span
      ref={containerRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {/* Clone child to add aria-describedby */}
      {/* We wrap child in a focusable span for keyboard accessibility */}
      <span
        tabIndex={0}
        aria-describedby={id}
        style={{ display: "inline-flex", alignItems: "center", outline: "none" }}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {children}
      </span>

      {visible && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(17,24,39,0.95)",
            color: "#fff",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            whiteSpace: "pre-line",
            width: "220px",
            zIndex: 50,
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          {content}
          {/* Arrow */}
          <span style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            borderWidth: "5px",
            borderStyle: "solid",
            borderColor: "rgba(17,24,39,0.95) transparent transparent transparent",
          }} />
        </span>
      )}
    </span>
  );
}
