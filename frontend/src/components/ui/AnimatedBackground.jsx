"use client";

import { useEffect, useRef } from "react";

export function AnimatedBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let animationFrameId;
    let time = 0;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    // Pre-build off-screen grain (static, reused each frame)
    const grainCanvas = document.createElement("canvas");
    const grainSize   = 256;
    grainCanvas.width = grainSize;
    grainCanvas.height = grainSize;
    const gc = grainCanvas.getContext("2d");
    const grainData = gc.createImageData(grainSize, grainSize);
    for (let i = 0; i < grainData.data.length; i += 4) {
      const v = Math.random() * 255;
      grainData.data[i]     = v;
      grainData.data[i + 1] = v;
      grainData.data[i + 2] = v;
      grainData.data[i + 3] = 18; // very low opacity grain
    }
    gc.putImageData(grainData, 0, 0);

    const draw = () => {
      time += 0.003;
      const { width, height } = canvas;

      // ── Base: warm sand gradient ──────────────────────────────
      const base = ctx.createLinearGradient(0, 0, width, height);
      base.addColorStop(0, "#EFEFED");
      base.addColorStop(1, "#E8E8E4");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);

      // ── Soft organic blobs (Collectif Parcelles style) ────────
      const blobs = [
        {
          x: width * 0.15 + Math.sin(time * 0.7) * 120,
          y: height * 0.25 + Math.cos(time * 0.5) * 80,
          r: width * 0.45,
          color: "rgba(142, 196, 160, 0.38)",
        },
        {
          x: width * 0.8 + Math.cos(time * 0.9) * 150,
          y: height * 0.75 + Math.sin(time * 0.6) * 100,
          r: width * 0.38,
          color: "rgba(142, 196, 160, 0.28)",
        },
        {
          x: width * 0.5 + Math.sin(time * 0.4 + 1) * 80,
          y: height * 0.55 + Math.cos(time * 0.35) * 60,
          r: width * 0.25,
          color: "rgba(229, 234, 220, 0.22)",
        },
      ];

      ctx.save();
      ctx.filter = "blur(90px)";
      for (const blob of blobs) {
        const g = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
        g.addColorStop(0, blob.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();

      // ── Technical Grid Overlay ────────────────────────────────
      ctx.save();
      ctx.strokeStyle = "rgba(10, 28, 22, 0.035)";
      ctx.lineWidth = 0.5;
      const gridSize = 48; // Grid square size in pixels
      
      // Vertical lines
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      
      // Horizontal lines
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();

      // ── Tile the pre-built grain texture ──────────────────────
      const pattern = ctx.createPattern(grainCanvas, "repeat");
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        pointerEvents: "none",
        opacity: 1,
      }}
    />
  );
}
