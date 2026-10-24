import SwiftUI

/// Stick figure that shows the tracked arm. Used for the demo rep, calibration and live tracking.
struct FigureView: View {
    enum Viewpoint { case front, side }

    var viewpoint: Viewpoint
    /// 0° = arm down, 90° = shoulder height, 180° = overhead.
    var elevation: Double
    /// 0° = straight ahead, 90° = out to the side.
    var plane: Double
    var leftArm: Bool = true
    var armColor: Color = .cyan
    var showTarget: Bool = true

    var body: some View {
        Canvas { ctx, size in
            let h = size.height, w = size.width
            let u = h / 10 // body unit
            let cx = w / 2
            let headR = u * 0.9
            let headC = CGPoint(x: cx, y: u * 1.2)
            let neck = CGPoint(x: cx, y: headC.y + headR)
            let hip = CGPoint(x: cx, y: u * 6.0)
            let armLen = u * 3.4
            let body = GraphicsContext.Shading.color(.white.opacity(0.85))
            let line = StrokeStyle(lineWidth: max(2, u * 0.35), lineCap: .round)

            // Head
            ctx.stroke(Path(ellipseIn: CGRect(x: headC.x - headR, y: headC.y - headR, width: headR * 2, height: headR * 2)),
                       with: body, style: line)

            let e = elevation * .pi / 180
            let p = plane * .pi / 180
            let vertical = -cos(e)            // +1 up, -1 down
            let outward = sin(e) * sin(p)     // toward the side
            let forward = sin(e) * cos(p)     // toward the front

            var path = Path()
            switch viewpoint {
            case .front:
                // Facing the viewer: the person's left arm appears on screen right.
                let side: CGFloat = leftArm ? 1 : -1
                let shL = CGPoint(x: cx + side * u * 1.3, y: neck.y + u * 0.5)
                let shO = CGPoint(x: cx - side * u * 1.3, y: shL.y)
                path.move(to: shO); path.addLine(to: shL)
                path.move(to: neck); path.addLine(to: hip)
                path.move(to: shO); path.addLine(to: CGPoint(x: shO.x - side * u * 0.3, y: shO.y + armLen))
                path.move(to: hip); path.addLine(to: CGPoint(x: cx - u, y: h - u * 0.3))
                path.move(to: hip); path.addLine(to: CGPoint(x: cx + u, y: h - u * 0.3))
                ctx.stroke(path, with: body, style: line)

                if showTarget {
                    var t = Path()
                    t.move(to: shL); t.addLine(to: CGPoint(x: shL.x + side * armLen, y: shL.y))
                    ctx.stroke(t, with: .color(.green.opacity(0.6)), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                }
                let hand = CGPoint(x: shL.x + side * armLen * outward, y: shL.y - armLen * vertical)
                drawArm(ctx, from: shL, to: hand, width: line.lineWidth * 1.3)

            case .side:
                // Profile facing right.
                let sh = CGPoint(x: cx, y: neck.y + u * 0.5)
                path.move(to: neck); path.addLine(to: hip)
                path.move(to: hip); path.addLine(to: CGPoint(x: cx + u * 0.2, y: h - u * 0.3))
                path.move(to: hip); path.addLine(to: CGPoint(x: cx - u * 0.2, y: h - u * 0.3))
                ctx.stroke(path, with: body, style: line)

                if showTarget {
                    var t = Path()
                    t.move(to: sh); t.addLine(to: CGPoint(x: sh.x + armLen, y: sh.y))
                    ctx.stroke(t, with: .color(.green.opacity(0.6)), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                }
                let hand = CGPoint(x: sh.x + armLen * forward, y: sh.y - armLen * vertical)
                drawArm(ctx, from: sh, to: hand, width: line.lineWidth * 1.3)
            }
        }
    }

    private func drawArm(_ ctx: GraphicsContext, from a: CGPoint, to b: CGPoint, width: CGFloat) {
        var arm = Path()
        arm.move(to: a); arm.addLine(to: b)
        ctx.stroke(arm, with: .color(armColor), style: StrokeStyle(lineWidth: width, lineCap: .round))
        let r = width * 0.9
        ctx.fill(Path(ellipseIn: CGRect(x: b.x - r, y: b.y - r, width: r * 2, height: r * 2)), with: .color(armColor))
    }
}

/// Animated example rep: arm goes up to shoulder height and back down every 3 seconds.
struct DemoFigure: View {
    var kind: ExerciseKind
    var leftArm: Bool

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let phase = (1 - cos(2 * .pi * t / 3)) / 2 // 0 → 1 → 0
            FigureView(viewpoint: kind.figureView, elevation: phase * REP_TARGET_DEG,
                       plane: kind.idealPlane, leftArm: leftArm, armColor: .yellow)
        }
    }
}
