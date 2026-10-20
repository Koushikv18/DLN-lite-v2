import React, { useEffect, useRef, useState } from "react";

function fitCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

export function WorldBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    let frame = 0;
    let animationId = 0;

    const routes = [
      { from: [0.78, 0.38], to: [0.32, 0.42] },
      { from: [0.15, 0.38], to: [0.55, 0.35] },
      { from: [0.6, 0.45], to: [0.3, 0.3] },
      { from: [0.45, 0.55], to: [0.85, 0.4] },
    ];

    const draw = () => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width: W, height: H } = fitted;

      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(30,80,200,0.06)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      routes.forEach((route, index) => {
        const fx = route.from[0] * W;
        const fy = route.from[1] * H;
        const tx = route.to[0] * W;
        const ty = route.to[1] * H;
        const cx = (fx + tx) / 2;
        const cy = Math.min(fy, ty) - 80;
        const progress = (frame * 0.002 + index * 0.2) % 1;

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(0,180,255,0.14)";
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo(cx, cy, tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        const bx = (1 - progress) * (1 - progress) * fx + 2 * (1 - progress) * progress * cx + progress * progress * tx;
        const by = (1 - progress) * (1 - progress) * fy + 2 * (1 - progress) * progress * cy + progress * progress * ty;
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 14);
        glow.addColorStop(0, "rgba(0,212,255,0.35)");
        glow.addColorStop(1, "rgba(0,212,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(bx, by, 14, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(0,212,255,0.9)";
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      frame += 1;
      animationId = window.requestAnimationFrame(draw);
    };

    draw();
    const onResize = () => fitCanvas(canvas);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas id="world-canvas" ref={ref} />;
}

export function ShipperScene() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    let t = 0;
    let animationId = 0;

    const draw = () => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width: W, height: H } = fitted;

      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#020812");
      sky.addColorStop(0.55, "#07142d");
      sky.addColorStop(1, "#0a1a40");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const vp = { x: W / 2, y: H * 0.6 };
      ctx.strokeStyle = "rgba(0,140,255,0.08)";
      for (let i = 0; i <= 18; i += 1) {
        const x = (i / 18) * W;
        ctx.beginPath();
        ctx.moveTo(vp.x, vp.y);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let row = 0; row < 7; row += 1) {
        const frac = row / 7;
        const y = vp.y + (H - vp.y) * frac;
        const xl = vp.x - vp.x * frac;
        const xr = vp.x + (W - vp.x) * frac;
        ctx.beginPath();
        ctx.moveTo(xl, y);
        ctx.lineTo(xr, y);
        ctx.stroke();
      }

      const whX = W * 0.05;
      const whY = H * 0.22;
      const whW = W * 0.24;
      const whH = H * 0.38;
      ctx.fillStyle = "#0d1e3a";
      ctx.fillRect(whX, whY, whW, whH);
      ctx.fillStyle = "#16346a";
      ctx.beginPath();
      ctx.moveTo(whX, whY);
      ctx.lineTo(whX + whW, whY);
      ctx.lineTo(whX + whW + 22, whY + 18);
      ctx.lineTo(whX + 22, whY + 18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0,212,255,0.45)";
      ctx.font = "700 18px Syne";
      ctx.fillText("WAREHOUSE", whX + 14, whY + 30);

      const portX = W * 0.73;
      const portY = H * 0.28;
      const portW = W * 0.2;
      const portH = H * 0.32;
      ctx.fillStyle = "#0b1730";
      ctx.fillRect(portX, portY, portW, portH);
      ctx.strokeStyle = "rgba(0,212,255,0.18)";
      ctx.strokeRect(portX, portY, portW, portH);
      ctx.fillStyle = "rgba(0,212,255,0.45)";
      ctx.fillText("PORT", portX + 14, portY + 30);

      ctx.strokeStyle = "rgba(0,212,255,0.5)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(portX + portW * 0.7, H * 0.6);
      ctx.lineTo(portX + portW * 0.7, portY - 16);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(portX + portW * 0.2, portY - 16);
      ctx.lineTo(portX + portW * 0.86, portY - 16);
      ctx.stroke();
      const cableY = portY + 10 + Math.sin(t * 0.04) * 18;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(portX + portW * 0.42, portY - 16);
      ctx.lineTo(portX + portW * 0.42, cableY + 12);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f39c12";
      ctx.fillRect(portX + portW * 0.32, cableY + 12, 46, 28);

      const roadY = H * 0.66;
      ctx.fillStyle = "rgba(20,40,80,0.7)";
      ctx.fillRect(0, roadY, W, H * 0.1);
      ctx.strokeStyle = "rgba(255,200,0,0.25)";
      ctx.setLineDash([18, 14]);
      ctx.beginPath();
      ctx.moveTo(0, roadY + H * 0.05);
      ctx.lineTo(W, roadY + H * 0.05);
      ctx.stroke();
      ctx.setLineDash([]);

      const truckX = (W * 0.18 + t * 1.8) % (W * 0.7);
      drawTruck(ctx, truckX, roadY - 12, 120, 52);

      for (let i = 0; i < 5; i += 1) {
        const x = W * 0.2 + i * 84;
        const y = H * 0.46 + Math.sin(t * 0.04 + i) * 12;
        ctx.fillStyle = "rgba(0,212,255,0.45)";
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        if (i < 4) {
          ctx.strokeStyle = "rgba(0,180,255,0.12)";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 84, H * 0.46 + Math.sin(t * 0.04 + i + 1) * 12);
          ctx.stroke();
        }
      }

      t += 1;
      animationId = window.requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => {
      window.removeEventListener("resize", draw);
      window.cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas id="shipper-canvas" ref={ref} />;
}

function drawTruck(ctx, x, y, w, h) {
  ctx.fillStyle = "#0d2050";
  ctx.fillRect(x, y + h * 0.2, w * 0.58, h * 0.62);
  ctx.strokeStyle = "rgba(0,180,255,0.28)";
  ctx.strokeRect(x, y + h * 0.2, w * 0.58, h * 0.62);
  ctx.fillStyle = "#1a3060";
  ctx.fillRect(x + w * 0.55, y + h * 0.12, w * 0.36, h * 0.7);
  ctx.fillStyle = "rgba(0,200,255,0.28)";
  ctx.fillRect(x + w * 0.58, y + h * 0.18, w * 0.28, h * 0.25);
  ctx.fillStyle = "rgba(0,180,255,0.6)";
  ctx.font = "700 14px Syne";
  ctx.fillText("CF", x + 14, y + 32);
  [[x + 18, y + 44], [x + 50, y + 44], [x + 84, y + 44], [x + 104, y + 44]].forEach(([wx, wy]) => {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function CarrierScene() {
  const ref = useRef(null);
  const [stormMode, setStormMode] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    let t = 0;
    let intensity = stormMode ? 1 : 0;
    let animationId = 0;

    const draw = () => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width: W, height: H } = fitted;
      intensity += (stormMode ? 1 : 0 - intensity) * 0.03;

      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      sky.addColorStop(0, intensity > 0.45 ? "#04050b" : "#020812");
      sky.addColorStop(0.65, intensity > 0.45 ? "#16111f" : "#052455");
      sky.addColorStop(1, intensity > 0.45 ? "#180f22" : "#0d3a73");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const ocean = ctx.createLinearGradient(0, H * 0.52, 0, H);
      ocean.addColorStop(0, intensity > 0.45 ? "#0b0714" : "#001a4a");
      ocean.addColorStop(1, intensity > 0.45 ? "#030107" : "#000d22");
      ctx.fillStyle = ocean;
      ctx.fillRect(0, H * 0.5, W, H * 0.5);

      for (let layer = 8; layer >= 0; layer -= 1) {
        const frac = layer / 8;
        const y = H * 0.56 + frac * H * 0.26;
        const amp = 8 + frac * 18 + intensity * 26;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= W; x += 5) {
          const wave = Math.sin((x / W) * Math.PI * (2.5 + frac * 2) + t * 0.04 * (1 + intensity) + layer) * amp;
          ctx.lineTo(x, y + wave);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = `rgba(${Math.round(10 + frac * 30)}, ${Math.round(60 + frac * 80)}, ${Math.round(120 + frac * 70)}, ${0.12 + frac * 0.12})`;
        ctx.fill();
      }

      drawShip(ctx, W * 0.46, H * 0.62 + Math.sin(t * 0.04) * (6 + intensity * 16), W * 0.22, H * 0.18, Math.sin(t * 0.03) * 0.02 * (1 + intensity * 4));

      if (intensity > 0.35) {
        ctx.strokeStyle = `rgba(180,210,255,${0.18 + intensity * 0.15})`;
        for (let i = 0; i < 60; i += 1) {
          const x = (i * 37 + t * 6) % (W + 40) - 20;
          const y = (i * 19 + t * 9) % (H + 60) - 40;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 6, y + 18);
          ctx.stroke();
        }
      }

      if (intensity > 0.6 && Math.floor(t) % 90 < 3) {
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fillRect(0, 0, W, H);
      }

      t += 1;
      animationId = window.requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => {
      window.removeEventListener("resize", draw);
      window.cancelAnimationFrame(animationId);
    };
  }, [stormMode]);

  return (
    <>
      <canvas id="carrier-canvas" ref={ref} />
      <button
        className={`weather-btn ${stormMode ? "storm" : "calm"}`}
        onClick={() => setStormMode((current) => !current)}
      >
        {stormMode ? "Storm Mode" : "Calm Seas"}
      </button>
    </>
  );
}

function drawShip(ctx, x, y, w, h, roll) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);
  const hull = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, h * 0.4);
  hull.addColorStop(0, "#1a3060");
  hull.addColorStop(1, "#05101f");
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.02);
  ctx.quadraticCurveTo(-w * 0.56, h * 0.18, -w * 0.34, h * 0.36);
  ctx.lineTo(w * 0.34, h * 0.36);
  ctx.quadraticCurveTo(w * 0.56, h * 0.18, w * 0.48, -h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0f2040";
  ctx.fillRect(-w * 0.42, -h * 0.28, w * 0.84, h * 0.24);
  const colors = ["#c0392b", "#1a6cf5", "#f39c12", "#27ae60", "#8e44ad"];
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(-w * 0.34 + i * (w * 0.14), -h * 0.24, w * 0.12, h * 0.12);
  }
  ctx.restore();
}

export function CustomsScene() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    let t = 0;
    let animationId = 0;

    const draw = () => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width: W, height: H } = fitted;

      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#030810");
      sky.addColorStop(0.65, "#061425");
      sky.addColorStop(1, "#0a1a35");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.fillRect(0, H * 0.62, W, H * 0.38);

      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          const x = 34 + col * 78;
          const y = H * 0.46 + row * 34;
          ctx.fillStyle = ["#1a6cf5", "#f39c12", "#27ae60", "#c0392b"][(row + col) % 4];
          ctx.fillRect(x, y, 62, 24);
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.strokeRect(x, y, 62, 24);
        }
      }

      ctx.strokeStyle = "rgba(0,212,255,0.42)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(W * 0.72, H * 0.72);
      ctx.lineTo(W * 0.72, H * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W * 0.58, H * 0.18);
      ctx.lineTo(W * 0.86, H * 0.18);
      ctx.stroke();

      const trolleyX = W * 0.63 + Math.sin(t * 0.03) * 48;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trolleyX, H * 0.18);
      ctx.lineTo(trolleyX, H * 0.44);
      ctx.stroke();
      ctx.fillStyle = "#00d4ff";
      ctx.fillRect(trolleyX - 22, H * 0.44, 44, 26);

      for (let i = 0; i < 8; i += 1) {
        const x = 24 + i * 92;
        const alpha = 0.18 + 0.18 * Math.sin(t * 0.05 + i);
        ctx.strokeStyle = `rgba(0,255,200,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, H * 0.22);
        ctx.lineTo(x + 18, H * 0.1);
        ctx.lineTo(x + 36, H * 0.22);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(0,212,255,0.45)";
      ctx.font = "700 14px JetBrains Mono";
      ctx.fillText("PORT TERMINAL / INSPECTION GRID", 24, 28);

      t += 1;
      animationId = window.requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => {
      window.removeEventListener("resize", draw);
      window.cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas id="customs-canvas" ref={ref} />;
}
