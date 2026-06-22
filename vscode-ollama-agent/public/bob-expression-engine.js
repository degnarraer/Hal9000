class BobExpressionEngine {
  constructor(root, options = {}) {
    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    this.options = options;
    this.emotion = 'idle';
    this.expression = {
      mouth: options.mouth || 'neutral',
      eyes: options.eyes || 'idle',
      brow: options.brow || 'idle',
      look: options.look || 'idle',
      head: options.head || 'idle'
    };
    this.speaking = false;
    this.mouthLevel = 0;
    this.idleMouthLevel = 0;
    this.frameId = null;
    this.lastBlink = 0;
    this.blinking = false;
    this.nextBlink = this.randomBlinkDelay();
    this.look = { x: 0, y: 0, targetX: 0, targetY: 0, nextAt: 0, ease: 0.04 };
    this.renderedLook = { x: 0, y: 0, manual: false };
    this.idleMouth = { nextAt: 0, closeAt: 0, target: 0, ease: 0.16 };
    this.idlePose = {
      bob: 0,
      tilt: 0,
      targetBob: 0,
      targetTilt: 0,
      nextAt: 0,
      ease: 0.025
    };
    this.parts = {};

    if (!this.root) return;
    this.parts.leftEye = this.root.querySelector('#bobLeftEye');
    this.parts.rightEye = this.root.querySelector('#bobRightEye');
    this.parts.leftEyeIcon = this.root.querySelector('#bobLeftEyeIcon');
    this.parts.rightEyeIcon = this.root.querySelector('#bobRightEyeIcon');
    this.parts.faceFeatures = this.root.querySelector('#bobFaceFeatures');
    this.parts.eyes = this.root.querySelector('#bobEyes');
    this.parts.mouth = this.root.querySelector('#bobMouth');
    this.parts.headFront = this.root.querySelector('#bobHeadFront');
    this.parts.headTop = this.root.querySelector('#bobHeadTop');
    this.parts.headRight = this.root.querySelector('#bobHeadRight') || this.root.querySelector('#bobHeadSide');
    this.parts.headBottom = this.root.querySelector('#bobHeadBottom');
    this.parts.headLeft = this.root.querySelector('#bobHeadLeft');
    this.parts.brow = this.root.querySelector('#bobBrow');
    this.parts.leftBrow = this.root.querySelector('#bobLeftBrow') || this.root.querySelector('#bobBrow path');
    this.parts.rightBrow = this.root.querySelector('#bobRightBrow') || this.root.querySelector('#bobBrow path');
    this.parts.forehead = this.root.querySelector('#bobForehead');
    this.parts.foreheadLine1 = this.root.querySelector('#bobForeheadLine1');
    this.parts.foreheadLine2 = this.root.querySelector('#bobForeheadLine2');
    this.root.classList.add('bob-face-ready');
    this.setEmotion(options.emotion || 'idle');
    this.start();
  }

  setEmotion(emotion = 'idle') {
    if (emotion === 'speaking') {
      this.startSpeaking();
      return;
    }
    this.emotion = emotion;
    this.root?.setAttribute('data-emotion', emotion);
    this.applyEmotionDefaults(emotion);
    if (emotion !== 'idle') {
      this.look.targetX = 0;
      this.look.targetY = 0;
      this.idlePose.targetBob = 0;
      this.idlePose.targetTilt = 0;
      this.idleMouthLevel = 0;
    }
    this.applyEmotion(0);
  }

  applyEmotionDefaults(emotion) {
    const defaults = {
      idle: { eyes: 'idle', brow: 'idle', look: 'idle', head: 'idle' },
      listening: { eyes: 'focused', brow: 'attentive', look: 'center', head: 'center' },
      thinking: { eyes: 'thinking', brow: 'thinking', look: 'thinking', head: 'center' },
      speaking: { mouth: 'talking' },
      happy: { mouth: 'happy', eyes: 'happy', brow: 'happy', look: 'center', head: 'center' },
      amused: { mouth: 'amused', eyes: 'happy', brow: 'happy', look: 'center', head: 'center' },
      love: { mouth: 'happy', eyes: 'hearts', brow: 'happy', look: 'center', head: 'center' },
      magic: { mouth: 'surprised', eyes: 'stars', brow: 'surprised', look: 'center', head: 'center' },
      confident: { mouth: 'smirk', eyes: 'focused', brow: 'confident', look: 'center', head: 'center' },
      curious: { mouth: 'smallSmile', eyes: 'wide', brow: 'curious', look: 'thinking', head: 'center' },
      focused: { mouth: 'neutral', eyes: 'focused', brow: 'focused', look: 'center', head: 'center' },
      sleepy: { mouth: 'neutral', eyes: 'sleepy', brow: 'soft', look: 'center', head: 'center' },
      annoyed: { mouth: 'flat', eyes: 'squint', brow: 'annoyed', look: 'center', head: 'center' },
      distrustful: { mouth: 'smirk', eyes: 'distrust', brow: 'annoyed', look: 'center', head: 'center' },
      sad: { mouth: 'sad', eyes: 'soft', brow: 'sad', look: 'center', head: 'center' },
      concerned: { mouth: 'concerned', eyes: 'soft', brow: 'concerned', look: 'center', head: 'center' },
      error: { mouth: 'concerned', eyes: 'error', brow: 'concerned', look: 'center', head: 'center' },
      surprised: { mouth: 'surprised', eyes: 'wide', brow: 'surprised', look: 'center', head: 'center' }
    };
    this.setExpression(defaults[emotion] || defaults.idle, { draw: false });
  }

  setExpression(parts = {}, options = {}) {
    Object.entries(parts).forEach(([part, value]) => {
      if (value) this.expression[part] = value;
    });
    if (options.draw !== false) this.applyEmotion(0);
  }

  setMouth(expression = 'neutral') {
    this.setExpression({ mouth: expression });
  }

  setEyes(expression = 'idle') {
    this.setExpression({ eyes: expression });
  }

  setBrow(expression = 'idle') {
    this.setExpression({ brow: expression });
  }

  setLook(expression = 'idle') {
    this.setExpression({ look: expression });
  }

  setLookVector(x = 0, y = 0) {
    const clamp = value => Math.max(-1, Math.min(1, Number(value) || 0));
    this.expression.look = 'manual';
    this.look.x = clamp(x) * 12;
    this.look.y = clamp(y) * 8;
    this.look.targetX = this.look.x;
    this.look.targetY = this.look.y;
    this.applyEmotion(0);
  }

  getRenderedLookVector() {
    return { ...this.renderedLook };
  }

  setHead(expression = 'idle') {
    this.setExpression({ head: expression });
  }

  smile() {
    this.setMouth('happy');
  }

  clearExpression(parts = ['mouth', 'eyes', 'brow', 'look', 'head']) {
    const defaults = { mouth: 'neutral', eyes: 'idle', brow: 'idle', look: 'idle', head: 'idle' };
    (Array.isArray(parts) ? parts : [parts]).forEach(part => {
      if (defaults[part]) this.expression[part] = defaults[part];
    });
    this.applyEmotion(0);
  }

  idle() {
    this.speaking = false;
    this.setMouthLevel(0);
    this.setEmotion('idle');
  }

  listen() {
    this.speaking = false;
    this.setEmotion('listening');
  }

  think() {
    this.speaking = false;
    this.setEmotion('thinking');
  }

  startSpeaking() {
    this.speaking = true;
    this.root?.setAttribute('data-speaking', 'true');
    this.drawMouth();
  }

  stopSpeaking() {
    this.speaking = false;
    this.root?.removeAttribute('data-speaking');
    this.setMouthLevel(0);
    this.drawMouth();
  }

  setMouthLevel(level = 0) {
    this.mouthLevel = Math.max(0, Math.min(1, Number(level) || 0));
    this.drawMouth();
  }

  start() {
    if (this.frameId) return;
    const tick = time => {
      this.applyEmotion(time);
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.frameId) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  applyEmotion(time) {
    if (!this.root) return;
    const pulse = Math.sin(time / 620);
    const drift = Math.sin(time / 1100) * 4;
    const activeGlow = this.emotion === 'listening';
    const thinking = this.expression.look === 'thinking';
    const idle = this.emotion === 'idle';
    const manualLook = this.expression.look === 'manual';
    if (idle && !manualLook) this.updateIdleMotion(time);
    const freeLook = this.expression.look === 'idle' && idle;
    const eyeX = manualLook ? this.look.x : thinking ? drift : (freeLook ? this.look.x : 0);
    const eyeY = (manualLook ? this.look.y : (freeLook ? this.look.y : 0)) + (idle || manualLook ? 0 : pulse * 1.5);
    this.renderedLook = {
      x: Math.max(-1, Math.min(1, eyeX / 12)),
      y: Math.max(-1, Math.min(1, eyeY / 8)),
      manual: manualLook
    };
    const browY = this.expression.brow === 'thinking' ? pulse * 2 : (freeLook ? this.look.y * 0.45 : 0);
    const headTilt = this.expression.head === 'idle' && idle ? this.idlePose.tilt : 0;

    const compression = this.headCompression(eyeX, eyeY);
    const featureX = manualLook ? eyeX : 0;
    const featureY = manualLook ? eyeY : 0;
    const detailEyeX = manualLook ? 0 : eyeX;
    const detailEyeY = manualLook ? 0 : eyeY;
    this.parts.headFront?.setAttribute('transform', compression);
    this.parts.faceFeatures?.setAttribute('transform', `${compression} translate(${featureX} ${featureY})`);
    this.parts.eyes?.setAttribute('transform', `translate(${detailEyeX} ${detailEyeY})`);
    this.parts.brow?.setAttribute('transform', `translate(${freeLook ? this.look.x * 0.2 : 0} ${browY})`);
    this.root.style.transform = `translateY(${this.expression.head === 'idle' && idle ? this.idlePose.bob : 0}px) rotate(${headTilt}deg)`;
    this.root.style.setProperty('--bob-glow', activeGlow ? '0.86' : '0.78');
    this.drawHeadDepth(eyeX, eyeY);
    this.drawEyes();
    this.drawBrow();

    if (this.shouldBlink(time)) this.blink();
    if (this.speaking && this.mouthLevel === 0) {
      this.setMouthLevel(0.12 + (Math.sin(time / 76) + 1) * 0.36);
    } else {
      this.drawMouth();
    }
  }

  updateIdleMotion(time) {
    if (!this.look.nextAt) this.look.nextAt = time + this.randomLookDelay();
    if (!this.idleMouth.nextAt) this.idleMouth.nextAt = time + this.randomMouthDelay();
    if (!this.idlePose.nextAt) this.idlePose.nextAt = time + this.randomPoseDelay();

    if (time > this.look.nextAt) {
      const settleCenter = Math.random() < 0.18;
      this.look.targetX = settleCenter ? 0 : this.randomRange(-12, 12);
      this.look.targetY = settleCenter ? 0 : this.randomRange(-6, 6);
      this.look.ease = this.randomRange(0.025, 0.09);
      this.look.nextAt = time + this.randomLookDelay();
    }

    this.look.x += (this.look.targetX - this.look.x) * this.look.ease;
    this.look.y += (this.look.targetY - this.look.y) * this.look.ease;

    if (time > this.idlePose.nextAt) {
      this.idlePose.targetBob = this.randomRange(-1.1, 1.1);
      this.idlePose.targetTilt = this.randomRange(-3.2, 3.2);
      this.idlePose.ease = this.randomRange(0.012, 0.05);
      this.idlePose.nextAt = time + this.randomPoseDelay();
    }

    this.idlePose.bob += (this.idlePose.targetBob - this.idlePose.bob) * this.idlePose.ease;
    this.idlePose.tilt += (this.idlePose.targetTilt - this.idlePose.tilt) * this.idlePose.ease;

    if (time > this.idleMouth.nextAt) {
      this.idleMouth.target = Math.random() < 0.22 ? 0 : this.randomRange(0.06, 0.32);
      this.idleMouth.ease = this.randomRange(0.07, 0.22);
      this.idleMouth.closeAt = time + this.randomRange(90, 520);
      this.idleMouth.nextAt = time + this.randomMouthDelay();
    }

    if (this.idleMouth.closeAt && time > this.idleMouth.closeAt) {
      this.idleMouth.target = 0;
      this.idleMouthLevel += (this.idleMouth.target - this.idleMouthLevel) * this.idleMouth.ease;
      if (this.idleMouthLevel < 0.01) {
        this.idleMouthLevel = 0;
        this.idleMouth.closeAt = 0;
      }
    } else {
      this.idleMouthLevel += (this.idleMouth.target - this.idleMouthLevel) * this.idleMouth.ease;
    }
  }

  shouldBlink(time) {
    if (!this.parts.leftEye || !this.parts.rightEye) return false;
    if (!this.lastBlink) this.lastBlink = time;
    return time - this.lastBlink > this.nextBlink;
  }

  blink() {
    this.lastBlink = performance.now();
    this.nextBlink = this.randomBlinkDelay();
    this.blinking = true;
    this.parts.leftEye?.setAttribute('ry', '5');
    this.parts.rightEye?.setAttribute('ry', '5');
    window.setTimeout(() => {
      this.blinking = false;
      this.drawEyes();
    }, 105);
  }

  randomBlinkDelay() {
    const doubleBlinkSoon = Math.random() < 0.16;
    return doubleBlinkSoon ? this.randomRange(130, 360) : this.randomRange(1200, 7200);
  }

  randomLookDelay() {
    return Math.random() < 0.2 ? this.randomRange(120, 420) : this.randomRange(650, 4200);
  }

  randomMouthDelay() {
    return Math.random() < 0.28 ? this.randomRange(260, 900) : this.randomRange(1200, 6200);
  }

  randomPoseDelay() {
    return this.randomRange(700, 5200);
  }

  randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  drawMouth() {
    const mouth = this.parts.mouth;
    if (!mouth) return;

    const activeMouthLevel = Math.max(this.mouthLevel, this.emotion === 'idle' ? this.idleMouthLevel : 0);
    if (this.speaking || activeMouthLevel > 0) {
      const drop = 5 + activeMouthLevel * 46;
      const inset = activeMouthLevel * 28;
      const left = 160 + inset;
      const right = 352 - inset;
      const jawY = 334 + drop;
      this.setMouthStyle({ strokeWidth: 22, fill: 'none', linecap: 'round' });
      mouth.setAttribute('d', `M160 334h192 M${left} ${jawY}h${right - left}`);
      return;
    }

    this.setMouthStyle();
    if (this.expression.mouth === 'happy') {
      mouth.setAttribute('d', 'M158 320 Q256 374 354 320');
      return;
    }

    if (this.expression.mouth === 'amused') {
      mouth.setAttribute('d', 'M154 312 Q256 392 358 312');
      return;
    }

    if (this.expression.mouth === 'smirk') {
      mouth.setAttribute('d', 'M166 334 Q240 362 348 316');
      return;
    }

    if (this.expression.mouth === 'smallSmile') {
      mouth.setAttribute('d', 'M178 328 Q256 354 334 328');
      return;
    }

    if (this.expression.mouth === 'flat') {
      mouth.setAttribute('d', 'M168 334h176');
      return;
    }

    if (this.expression.mouth === 'sad') {
      mouth.setAttribute('d', 'M168 354 Q256 310 344 354');
      return;
    }

    if (this.expression.mouth === 'concerned') {
      mouth.setAttribute('d', 'M168 350 Q256 312 344 350');
      return;
    }

    if (this.expression.mouth === 'surprised') {
      mouth.setAttribute('d', 'M220 330 Q256 286 292 330 Q256 374 220 330');
      return;
    }

    mouth.setAttribute('d', 'M160 334h192');
  }

  drawHeadDepth(lookX = 0, lookY = 0) {
    if (!this.parts.headTop && !this.parts.headRight && !this.parts.headBottom && !this.parts.headLeft) return;
    const x = -Math.max(-1, Math.min(1, lookX / 12));
    const y = -Math.max(-1, Math.min(1, lookY / 8));
    const depthFill = '#1f3f82';
    const scaleX = 1 - Math.abs(x) * 0.18;
    const scaleY = 1 - Math.abs(y) * 0.13;
    const frontLeft = 256 - 192 * scaleX;
    const frontRight = 256 + 192 * scaleX;
    const frontTop = 256 - 192 * scaleY;
    const frontBottom = 256 + 192 * scaleY;
    const cornerX = 64 * scaleX;
    const cornerY = 64 * scaleY;
    const visibleX = Math.abs(x);
    const visibleY = Math.abs(y);
    const turnAmount = Math.min(1, Math.hypot(x, y));
    const vanishingPoint = {
      x: 256 + x * (700 + visibleX * 230),
      y: 256 + y * (700 + visibleY * 230)
    };
    const projectDepth = (point, amount) => ({
      x: point.x + (vanishingPoint.x - point.x) * amount,
      y: point.y + (vanishingPoint.y - point.y) * amount
    });
    const depth = 0.06 + turnAmount * 0.032;
    const frontTopLeft = { x: frontLeft + cornerX, y: frontTop };
    const frontTopRight = { x: frontRight - cornerX, y: frontTop };
    const frontRightTop = { x: frontRight, y: frontTop + cornerY };
    const frontRightBottom = { x: frontRight, y: frontBottom - cornerY };
    const frontBottomRight = { x: frontRight - cornerX, y: frontBottom };
    const frontBottomLeft = { x: frontLeft + cornerX, y: frontBottom };
    const frontLeftBottom = { x: frontLeft, y: frontBottom - cornerY };
    const frontLeftTop = { x: frontLeft, y: frontTop + cornerY };
    const frontTopLeftCorner = { x: frontLeft, y: frontTop };
    const frontTopRightCorner = { x: frontRight, y: frontTop };
    const frontBottomRightCorner = { x: frontRight, y: frontBottom };
    const frontBottomLeftCorner = { x: frontLeft, y: frontBottom };
    const backTopLeft = projectDepth(frontTopLeft, depth);
    const backTopRight = projectDepth(frontTopRight, depth);
    const backRightTop = projectDepth(frontRightTop, depth);
    const backRightBottom = projectDepth(frontRightBottom, depth);
    const backBottomRight = projectDepth(frontBottomRight, depth);
    const backBottomLeft = projectDepth(frontBottomLeft, depth);
    const backLeftBottom = projectDepth(frontLeftBottom, depth);
    const backLeftTop = projectDepth(frontLeftTop, depth);
    const backTopLeftCorner = projectDepth(frontTopLeftCorner, depth);
    const backTopRightCorner = projectDepth(frontTopRightCorner, depth);
    const backBottomRightCorner = projectDepth(frontBottomRightCorner, depth);
    const backBottomLeftCorner = projectDepth(frontBottomLeftCorner, depth);
    const point = value => `${value.x.toFixed(2)} ${value.y.toFixed(2)}`;
    const linePath = (...points) => points
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${point(value)}`)
      .join(' ') + 'Z';
    const cornerControl = (control, start, end) => ({
      x: control.x * 0.74 + ((start.x + end.x) / 2) * 0.26,
      y: control.y * 0.74 + ((start.y + end.y) / 2) * 0.26
    });
    const depthOpacity = String(0.16 + turnAmount * 0.42);

    this.parts.headTop?.setAttribute('d', [
      `M${point(frontLeftTop)}`,
      `Q${point(cornerControl(frontTopLeftCorner, frontLeftTop, frontTopLeft))} ${point(frontTopLeft)}`,
      `L${point(frontTopRight)}`,
      `Q${point(cornerControl(frontTopRightCorner, frontTopRight, frontRightTop))} ${point(frontRightTop)}`,
      `L${point(backRightTop)}`,
      `Q${point(cornerControl(backTopRightCorner, backRightTop, backTopRight))} ${point(backTopRight)}`,
      `L${point(backTopLeft)}`,
      `Q${point(cornerControl(backTopLeftCorner, backTopLeft, backLeftTop))} ${point(backLeftTop)}`,
      'Z'
    ].join(' '));
    this.parts.headTop?.setAttribute('fill', depthFill);
    this.parts.headTop?.setAttribute('opacity', depthOpacity);

    this.parts.headRight?.setAttribute('d', linePath(frontRightTop, backRightTop, backRightBottom, frontRightBottom));
    this.parts.headRight?.setAttribute('fill', depthFill);
    this.parts.headRight?.setAttribute('opacity', depthOpacity);

    this.parts.headBottom?.setAttribute('d', [
      `M${point(frontLeftBottom)}`,
      `Q${point(cornerControl(frontBottomLeftCorner, frontLeftBottom, frontBottomLeft))} ${point(frontBottomLeft)}`,
      `L${point(frontBottomRight)}`,
      `Q${point(cornerControl(frontBottomRightCorner, frontBottomRight, frontRightBottom))} ${point(frontRightBottom)}`,
      `L${point(backRightBottom)}`,
      `Q${point(cornerControl(backBottomRightCorner, backRightBottom, backBottomRight))} ${point(backBottomRight)}`,
      `L${point(backBottomLeft)}`,
      `Q${point(cornerControl(backBottomLeftCorner, backBottomLeft, backLeftBottom))} ${point(backLeftBottom)}`,
      'Z'
    ].join(' '));
    this.parts.headBottom?.setAttribute('fill', depthFill);
    this.parts.headBottom?.setAttribute('opacity', depthOpacity);

    this.parts.headLeft?.setAttribute('d', linePath(frontLeftTop, backLeftTop, backLeftBottom, frontLeftBottom));
    this.parts.headLeft?.setAttribute('fill', depthFill);
    this.parts.headLeft?.setAttribute('opacity', depthOpacity);
  }

  headCompression(lookX = 0, lookY = 0) {
    const x = Math.max(-1, Math.min(1, lookX / 12));
    const y = Math.max(-1, Math.min(1, lookY / 8));
    const scaleX = 1 - Math.abs(x) * 0.18;
    const scaleY = 1 - Math.abs(y) * 0.13;
    const offsetX = -x * 9;
    const offsetY = -y * 6;
    return `translate(${256 * (1 - scaleX) + offsetX} ${256 * (1 - scaleY) + offsetY}) scale(${scaleX} ${scaleY})`;
  }

  setMouthStyle({ strokeWidth = 28, fill = 'none', linecap = 'round' } = {}) {
    const mouth = this.parts.mouth;
    if (!mouth) return;
    mouth.setAttribute('stroke-width', String(strokeWidth));
    mouth.setAttribute('fill', fill);
    mouth.setAttribute('stroke-linecap', linecap);
  }

  drawEyes() {
    if (this.blinking) return;
    const eyeShapes = {
      wide: { rx: 40, ry: 43 },
      soft: { rx: 32, ry: 25 },
      focused: { rx: 35, ry: 29 },
      thinking: { rx: 33, ry: 30 },
      happy: { rx: 34, ry: 19 },
      sleepy: { rx: 36, ry: 10 },
      squint: { rx: 38, ry: 14 },
      distrust: { leftRx: 39, leftRy: 15, rightRx: 28, rightRy: 24 },
      error: { rx: 34, ry: 34 },
      idle: { rx: 34, ry: 34 }
    };
    const shape = eyeShapes[this.expression.eyes] || eyeShapes.idle;
    const symbol = {
      hearts: this.heartEyePaths(),
      stars: this.starEyePaths()
    }[this.expression.eyes];

    if (symbol) {
      this.parts.leftEye?.setAttribute('opacity', '0');
      this.parts.rightEye?.setAttribute('opacity', '0');
      this.parts.leftEyeIcon?.setAttribute('d', symbol.left);
      this.parts.rightEyeIcon?.setAttribute('d', symbol.right);
      this.parts.leftEyeIcon?.setAttribute('opacity', '1');
      this.parts.rightEyeIcon?.setAttribute('opacity', '1');
      return;
    }

    this.parts.leftEye?.setAttribute('opacity', '1');
    this.parts.rightEye?.setAttribute('opacity', '1');
    this.parts.leftEyeIcon?.setAttribute('opacity', '0');
    this.parts.rightEyeIcon?.setAttribute('opacity', '0');
    this.parts.leftEye?.setAttribute('rx', String(shape.leftRx || shape.rx));
    this.parts.leftEye?.setAttribute('ry', String(shape.leftRy || shape.ry));
    this.parts.rightEye?.setAttribute('rx', String(shape.rightRx || shape.rx));
    this.parts.rightEye?.setAttribute('ry', String(shape.rightRy || shape.ry));
  }

  heartEyePaths() {
    return {
      left: this.heartPath(186, 236, 1),
      right: this.heartPath(326, 236, 1)
    };
  }

  starEyePaths() {
    return {
      left: this.starPath(186, 236, 39, 17, 5),
      right: this.starPath(326, 236, 39, 17, 5)
    };
  }

  heartPath(cx, cy, scale = 1) {
    const x = value => cx + value * scale;
    const y = value => cy + value * scale;
    return [
      `M${cx} ${y(30)}`,
      `C${x(-42)} ${y(-4)} ${x(-31)} ${y(-44)} ${cx} ${y(-22)}`,
      `C${x(31)} ${y(-44)} ${x(42)} ${y(-4)} ${cx} ${y(30)}Z`
    ].join(' ');
  }

  starPath(cx, cy, outer, inner, points) {
    const coords = [];
    for (let index = 0; index < points * 2; index += 1) {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + index * Math.PI / points;
      coords.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    return coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z';
  }

  drawBrow() {
    if (!this.parts.leftBrow && !this.parts.rightBrow) return;
    const brows = {
      attentive: ['M126 148 Q176 140 226 148', 'M286 148 Q336 140 386 148'],
      thinking: ['M126 158 Q176 144 226 150', 'M286 150 Q336 144 386 158'],
      happy: ['M126 158 Q176 136 226 148', 'M286 148 Q336 136 386 158'],
      confident: ['M126 152 Q176 142 226 146', 'M286 156 Q336 148 386 142'],
      curious: ['M126 162 Q176 140 226 148', 'M286 146 Q336 136 386 148'],
      focused: ['M126 154 Q176 148 226 152', 'M286 152 Q336 148 386 154'],
      soft: ['M126 152 Q176 156 226 152', 'M286 152 Q336 156 386 152'],
      annoyed: ['M126 138 Q176 150 226 162', 'M286 162 Q336 150 386 138'],
      sad: ['M126 166 Q176 144 226 156', 'M286 156 Q336 144 386 166'],
      concerned: ['M126 162 Q176 142 226 154', 'M286 154 Q336 142 386 162'],
      surprised: ['M126 134 Q176 122 226 134', 'M286 134 Q336 122 386 134'],
      idle: ['M126 150h102', 'M284 150h102']
    }[this.expression.brow] || ['M126 150h102', 'M284 150h102'];
    const forehead = {
      attentive: ['M162 104 Q256 96 350 104', 'M190 126 Q256 120 322 126', 0.14, 0.08],
      thinking: ['M156 108 Q256 90 356 108', 'M184 131 Q256 119 328 131', 0.24, 0.14],
      happy: ['M168 108 Q256 100 344 108', 'M196 128 Q256 123 316 128', 0.1, 0.05],
      confident: ['M162 106 Q256 98 350 106', 'M192 128 Q256 122 320 128', 0.12, 0.07],
      curious: ['M158 108 Q256 92 354 104', 'M188 130 Q256 120 324 126', 0.2, 0.11],
      focused: ['M162 107 Q256 99 350 107', 'M190 129 Q256 123 322 129', 0.15, 0.09],
      soft: ['M170 108 Q256 102 342 108', 'M196 128 Q256 124 316 128', 0.08, 0.04],
      annoyed: ['M154 104 Q256 93 358 104', 'M184 126 Q256 118 328 126', 0.2, 0.12],
      sad: ['M156 110 Q256 96 356 110', 'M184 134 Q256 122 328 134', 0.18, 0.1],
      concerned: ['M154 108 Q256 92 358 108', 'M184 132 Q256 119 328 132', 0.26, 0.15],
      surprised: ['M150 100 Q256 82 362 100', 'M180 124 Q256 112 332 124', 0.3, 0.18],
      idle: ['M160 104 Q256 94 352 104', 'M186 126 Q256 119 326 126', 0.16, 0.1]
    }[this.expression.brow] || ['M160 104 Q256 94 352 104', 'M186 126 Q256 119 326 126', 0.16, 0.1];

    this.parts.leftBrow?.setAttribute('d', brows[0]);
    this.parts.rightBrow?.setAttribute('d', brows[1]);
    this.parts.foreheadLine1?.setAttribute('d', forehead[0]);
    this.parts.foreheadLine2?.setAttribute('d', forehead[1]);
    this.parts.foreheadLine1?.setAttribute('opacity', String(forehead[2]));
    this.parts.foreheadLine2?.setAttribute('opacity', String(forehead[3]));
  }
}

window.BobExpressionEngine = BobExpressionEngine;
