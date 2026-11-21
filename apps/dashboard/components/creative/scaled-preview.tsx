"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Creative previews render a fixed-size canvas (1080px wide, up to 1920px
 * tall). An unscaled iframe shows only the top-left corner of that canvas, so
 * headlines look enormous and body copy falls outside the frame. This frame
 * measures its own width and scales the whole document down to fit.
 */
export function ScaledPreview({
  src,
  title,
  width = 1080,
  height = 1080,
  className,
}: {
  src: string;
  title: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const update = () => setScale(node.clientWidth ? node.clientWidth / width : 0);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div
      ref={box}
      className={`creative-scaled-frame${className ? ` ${className}` : ""}`}
      style={{ blockSize: scale > 0 ? `${Math.round(height * scale)}px` : undefined }}
    >
      <iframe
        title={title}
        src={src}
        tabIndex={-1}
        loading="lazy"
        sandbox=""
        style={{ width, height, transform: `scale(${scale})`, opacity: scale > 0 ? 1 : 0 }}
      />
    </div>
  );
}
