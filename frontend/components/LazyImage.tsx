"use client";

import { useEffect, useRef, useState } from "react";
import { colors } from "../styles/design-system";

interface LazyImageProps {
  src: string;
  alt: string;
  /** Both required so the placeholder reserves the final size — no layout shift once the image loads. */
  width: number;
  height: number;
  borderRadius?: string;
  className?: string;
  style?: React.CSSProperties;
  /**
   * How far outside the viewport to start loading, passed straight to
   * IntersectionObserver's rootMargin. Defaults to "200px" so images are
   * fetched a little before they'd actually become visible.
   */
  rootMargin?: string;
}

/**
 * An <img> that defers its network fetch until it's about to scroll into
 * view. A shimmer placeholder (visually consistent with LoadingSkeleton)
 * fills its reserved space until the real image has loaded; a neutral
 * fallback icon replaces it if the load fails.
 *
 * Uses IntersectionObserver directly (rather than relying solely on the
 * browser's native `loading="lazy"`) so the fetch is provably deferred and
 * testable, and so there's an explicit hook for the placeholder-to-image
 * transition. Falls back to loading eagerly if IntersectionObserver isn't
 * available (older browsers, or non-DOM test environments).
 */
export default function LazyImage({
  src,
  alt,
  width,
  height,
  borderRadius = "0.5rem",
  className,
  style,
  rootMargin = "200px",
}: LazyImageProps) {
  const [inView, setInView] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      // No IO support — just load eagerly rather than never loading at all.
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width,
        height,
        borderRadius,
        overflow: "hidden",
        background: colors.neutral[100],
        flexShrink: 0,
        ...style,
      }}
    >
      {status !== "loaded" && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              status === "error"
                ? colors.neutral[100]
                : `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
            backgroundSize: "200% 100%",
            animation: status === "error" ? undefined : "lazy-image-shimmer 1.5s infinite",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.neutral[400],
            fontSize: Math.min(width, height) * 0.35,
          }}
        >
          {status === "error" && "🖼"}
        </div>
      )}

      {inView && status !== "error" && (
        // eslint-disable-next-line @next/next/no-img-element -- deliberately not next/image: this is a
        // generic, framework-agnostic lazy-load primitive driven by our own IntersectionObserver.
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: status === "loaded" ? 1 : 0,
            transition: "opacity 0.25s ease",
            position: "absolute",
            inset: 0,
          }}
        />
      )}

      <style>{`
        @keyframes lazy-image-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
