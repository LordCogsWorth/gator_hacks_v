// Live webcam with the skeleton drawn on top. Starts the tracker while it is on screen.
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tracker } from '../../camera';
import type { Point2D, TrackerStatus, TrackingFrame } from '../../camera/types';
import { Badge } from '../../ui';

// Index pairs into MAIN_JOINTS (see camera/types.ts).
const BONES: [number, number][] = [
  [1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12],
];

const FALLBACK_DETAIL: Record<NonNullable<TrackerStatus['reason']>, string> = {
  forced: 'Simulated motion was chosen with ?tracker=fake.',
  demo: 'Demo mode uses simulated motion.',
  'no-camera': 'No camera was found or camera access was blocked.',
  'model-load': 'The body-tracking model could not be loaded.',
  timeout: 'The body-tracking model took too long to load.',
};

export function CameraView({
  onFrame,
  outline = false,
  demoPanel = false,
}: {
  onFrame?: (f: TrackingFrame) => void;
  outline?: boolean;
  /** The demo controls are showing, so simulated motion is expected and needs no warning. */
  demoPanel?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<TrackerStatus>(() => tracker.status());
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const unsubscribe = tracker.onFrame((f) => {
      draw(canvas.current, f.joints2d);
      onFrameRef.current?.(f);
    });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        if (cancelled || !video.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
      } catch {
        // No camera: the tracker falls back to simulated motion and status() says why.
      }
      if (!cancelled && video.current) await tracker.start(video.current);
      if (!cancelled) setStatus(tracker.status());
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      tracker.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const showFallback = status.mode === 'fake' && !demoPanel;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-surface-2">
      {/* Mirrored like a selfie so moving your right arm moves the right side of the picture. */}
      <video ref={video} muted playsInline className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      <canvas ref={canvas} width={1280} height={720} className="absolute inset-0 h-full w-full -scale-x-100" />
      {outline && <SeatOutline />}
      {showFallback && (
        <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)]" role="status">
          <Badge tone="warning" icon={<TriangleAlert />} title={status.reason ? FALLBACK_DETAIL[status.reason] : undefined}>
            Demo motion: camera tracking unavailable
          </Badge>
        </div>
      )}
    </div>
  );
}

function SeatOutline() {
  return (
    <svg viewBox="0 0 160 90" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <g fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="3 2">
        <circle cx="80" cy="24" r="8" />
        <path d="M58 70 Q58 40 80 37 Q102 40 102 70 Z" />
      </g>
    </svg>
  );
}

function draw(c: HTMLCanvasElement | null, pts: Point2D[] | null) {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!pts) return;
  const P = (p: Point2D) => [p.x * c.width, p.y * c.height] as const;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#38bdf8';
  for (const [a, b] of BONES) {
    if (pts[a].visibility < 0.5 || pts[b].visibility < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(...P(pts[a]));
    ctx.lineTo(...P(pts[b]));
    ctx.stroke();
  }
  ctx.fillStyle = '#facc15';
  for (const p of pts.slice(1, 7)) {
    ctx.beginPath();
    ctx.arc(...P(p), 10, 0, Math.PI * 2);
    ctx.fill();
  }
}
