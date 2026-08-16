/* ============================================================
   Avatar scenes — one embedded 3D character per section.
   Each section has its own canvas with choreographed moments:
   hero (wave) → about (walks in) → experience (walks, puts on
   glasses) → projects (takes laptop out of bag) → skills
   (points) → closing (sits at a table, shirt & tie, eye contact).

   Scenes are built lazily, animate only while visible, and fall
   back to a flat SVG avatar if WebGL is unavailable.
   ============================================================ */

(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* per-scene config: camera, character placement, choreography */
  var SCENE_CFG = {
    hero:       { cam: [0, 1.15, 4.8], look: [0, 1.1, 0],   scale: 1.0, finalX: 0,    choreo: "hero" },
    about:      { cam: [0, 1.1, 4.5],  look: [0, 1.05, 0],  scale: 1.0, finalX: 0.85, choreo: "walkin" },
    experience: { cam: [0, 1.15, 4.6], look: [0, 1.05, 0],  scale: 1.0, finalX: 0.55, choreo: "walkglasses" },
    projects:   { cam: [0, 1.15, 4.6], look: [0, 1.05, 0],  scale: 1.0, finalX: 0,    choreo: "laptopout" },
    skills:     { cam: [0, 1.1, 4.5],  look: [0, 1.05, 0],  scale: 1.0, finalX: 0,    choreo: "point" },
    closing:    { cam: [0, 1.45, 4.1], look: [0, 1.05, 0.3], scale: 0.8, finalX: 0,    choreo: "sitdown" }
  };

  /* accessories shown per scene (glasses stay on once put on) */
  var ACCESSORY_MAP = {
    hero:       [],
    about:      [],
    experience: ["glasses"],
    projects:   ["glasses", "laptop", "bag"],
    skills:     ["glasses", "laptop"],
    closing:    ["tie"]
  };

  var scenes = {};        // key -> scene object
  var activeKey = null;
  var fallbackMode = false;

  /* ---------------- materials ---------------- */

  function mat(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.55, metalness: 0.1 }, opts || {}));
  }

  /* ---------------- character rig ---------------- */

  function buildRig() {
    var rig = {
      group: new THREE.Group(),
      /* a lit navy-indigo, not near-black — the suit has to read against #0A0E1A */
      suit: mat(0x2B3A66, { roughness: 0.5, metalness: 0.22 }),
      shirt: mat(0xEEF2FA, { roughness: 0.6 }),
      skin: mat(0xE3AB74, { roughness: 0.62 }),
      dark: mat(0x2B3550, { roughness: 0.7 }),
      gold: mat(0xF0BE57, { metalness: 0.8, roughness: 0.22 })
    };

    /* legs */
    rig.leftLeg = buildLeg(-0.19, rig);
    rig.rightLeg = buildLeg(0.19, rig);
    rig.group.add(rig.leftLeg);
    rig.group.add(rig.rightLeg);

    /* torsos (suit + shirt variants) — slim, less balloon-like */
    var torsoGeo = new THREE.SphereGeometry(0.55, 32, 32);
    rig.suitTorso = new THREE.Mesh(torsoGeo, rig.suit);
    rig.suitTorso.scale.set(1, 1.3, 0.8);
    rig.suitTorso.position.y = 1.2;
    rig.group.add(rig.suitTorso);

    rig.shirtTorso = new THREE.Mesh(torsoGeo, rig.shirt);
    rig.shirtTorso.scale.set(1, 1.3, 0.8);
    rig.shirtTorso.position.y = 1.2;
    rig.shirtTorso.visible = false;
    rig.group.add(rig.shirtTorso);

    /* tie */
    rig.tie = new THREE.Group();
    var tieKnot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), rig.gold);
    tieKnot.position.y = 0.06;
    rig.tie.add(tieKnot);
    var tieBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.03), rig.gold);
    tieBody.position.y = -0.14;
    rig.tie.add(tieBody);
    rig.tie.position.set(0, 1.52, 0.47);
    rig.tie.visible = false;
    rig.group.add(rig.tie);

    /* chest badge (suit only) */
    rig.badge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.025), rig.gold);
    rig.badge.position.set(0, 1.42, 0.44);
    rig.group.add(rig.badge);

    /* suit buttons */
    [1.28, 1.12, 0.96].forEach(function (y) {
      var btn = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), rig.gold);
      btn.position.set(0, y, 0.45);
      rig.group.add(btn);
    });

    /* shirt collar (suit + shirt variants) */
    rig.collarSuit = buildCollar(rig, 1.72);
    rig.group.add(rig.collarSuit);
    rig.collarShirt = buildCollar(rig, 1.72);
    rig.collarShirt.visible = false;
    rig.group.add(rig.collarShirt);

    /* arms */
    rig.leftArm = buildArm(-1, rig);
    rig.rightArm = buildArm(1, rig);
    rig.group.add(rig.leftArm);
    rig.group.add(rig.rightArm);

    /* neck — bridges torso and head so the head doesn't float */
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.34, 20), rig.skin);
    neck.position.y = 1.86;
    rig.group.add(neck);
    rig.neck = neck;

    /* head */
    rig.head = new THREE.Group();
    rig.head.position.y = 2.18;
    var skull = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), rig.skin);
    skull.scale.set(1, 1.08, 0.98); /* a touch taller than a ball = more head-like */
    rig.head.add(skull);
    /* jaw taper for a defined chin */
    var jaw = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 24), rig.skin);
    jaw.scale.set(0.92, 0.78, 0.9);
    jaw.position.y = -0.2;
    rig.head.add(jaw);
    /* ears */
    [-0.38, 0.38].forEach(function (x) {
      var ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), rig.skin);
      ear.scale.set(0.6, 1, 0.7);
      ear.position.set(x, -0.02, 0.02);
      rig.head.add(ear);
    });

    /* hair — layered, swept, not a helmet */
    var hairBase = new THREE.Mesh(new THREE.SphereGeometry(0.415, 32, 32), rig.dark);
    hairBase.scale.set(1.04, 0.62, 1.05);
    hairBase.position.set(0, 0.14, -0.01);
    rig.head.add(hairBase);
    var hairFringe = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), rig.dark);
    hairFringe.scale.set(0.72, 0.5, 0.62);
    hairFringe.position.set(0.11, 0.2, 0.12);
    hairFringe.rotation.z = -0.25;
    rig.head.add(hairFringe);

    /* nose — subtle */
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), rig.skin);
    nose.position.set(0, -0.02, 0.365);
    rig.head.add(nose);

    rig.eyeL = buildEye(-0.125, rig);
    rig.eyeR = buildEye(0.125, rig);
    rig.head.add(rig.eyeL);
    rig.head.add(rig.eyeR);

    /* brows — angled, not flat bars */
    [-0.125, 0.125].forEach(function (x) {
      var brow = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.05), rig.dark);
      brow.position.set(x, 0.115, 0.36);
      brow.rotation.z = x > 0 ? -0.1 : 0.1;
      rig.head.add(brow);
    });

    /* mouth — soft smile arc instead of a box */
    rig.mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.009, 8, 20, Math.PI),
      mat(0x7A4A2E, { roughness: 0.7 })
    );
    rig.mouth.rotation.z = Math.PI; /* arc opens downward = smile */
    rig.mouth.position.set(0, -0.13, 0.35);
    rig.head.add(rig.mouth);

    rig.group.add(rig.head);

    /* accessories */
    rig.glasses = buildGlasses(rig);
    rig.laptop = buildLaptop(rig);
    rig.bag = buildBag(rig);
    rig.group.add(rig.glasses);
    rig.group.add(rig.laptop);
    rig.group.add(rig.bag);
    rig.glasses.visible = false;
    rig.laptop.visible = false;
    rig.bag.visible = false;

    return rig;
  }

  function buildCollar(rig, y) {
    /* open shirt collar: two flaps splaying out at the top, meeting low on the
       chest to form a clean V (reads as a dress shirt, not teeth) */
    var g = new THREE.Group();
    g.position.set(0, y, 0.4);
    var cloth = mat(0xEEF2FA, { roughness: 0.55 });
    [-1, 1].forEach(function (side) {
      var flap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.04), cloth);
      flap.position.set(side * 0.075, -0.07, 0);
      flap.rotation.z = side * 0.34;
      g.add(flap);
    });
    return g;
  }

  function buildLeg(x, rig) {
    var pivot = new THREE.Group();
    pivot.position.set(x, 0.55, 0);
    var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.5, 14), rig.suit);
    thigh.position.y = -0.25;
    pivot.add(thigh);
    var foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), rig.dark);
    foot.position.y = -0.53;
    pivot.add(foot);
    return pivot;
  }

  function buildArm(side, rig) {
    var pivot = new THREE.Group();
    pivot.position.set(0.62 * side, 1.62, 0);
    /* rounded shoulder cap fills the torso→arm seam */
    var shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), rig.suit);
    shoulder.position.y = -0.02;
    pivot.add(shoulder);
    var upper = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.105, 0.62, 16), rig.suit);
    upper.position.y = -0.38;
    pivot.add(upper);
    /* wrist/cuff so the hand isn't a bare ball on a stick */
    var cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), rig.shirt);
    cuff.position.y = -0.7;
    pivot.add(cuff);
    var hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 20), rig.skin);
    hand.scale.set(1, 1.15, 0.85);
    hand.position.y = -0.79;
    pivot.add(hand);
    pivot.rotation.z = 0.14 * side;
    return pivot;
  }

  function buildEye(x, rig) {
    var g = new THREE.Group();
    g.position.set(x, 0.02, 0.345);
    var white = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 20), mat(0xF4F6FB, { roughness: 0.25 }));
    g.add(white);
    var iris = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), mat(0x4A3423, { roughness: 0.2 }));
    iris.position.z = 0.048;
    g.add(iris);
    var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), mat(0x10131C, { roughness: 0.15 }));
    pupil.position.z = 0.068;
    g.add(pupil);
    return g;
  }

  function buildGlasses(rig) {
    var g = new THREE.Group();
    g.position.set(0, 2.13, 0.345);
    var lensMat = new THREE.MeshBasicMaterial({ color: 0xE8B34B, transparent: true, opacity: 0.14, side: THREE.DoubleSide });
    [-0.125, 0.125].forEach(function (x) {
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.013, 10, 28), rig.gold);
      rim.position.x = x;
      g.add(rim);
      var lens = new THREE.Mesh(new THREE.CircleGeometry(0.088, 24), lensMat);
      lens.position.set(x, 0, 0.006);
      g.add(lens);
      var temple = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.14), rig.gold);
      temple.position.set(x, 0, -0.08);
      g.add(temple);
    });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.016, 0.016), rig.gold));
    return g;
  }

  function buildLaptop(rig) {
    var g = new THREE.Group();
    g.position.set(0.32, 1.02, 0.42);
    g.rotation.y = -0.35;
    var body = mat(0x101827, { roughness: 0.5, metalness: 0.3 });
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.34), body);
    g.add(base);
    /* keyboard deck detail */
    var kb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.012, 0.26), mat(0x1A2338, { roughness: 0.45 }));
    kb.position.set(0, 0.03, 0.02);
    g.add(kb);
    var trackpad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.1), mat(0x2A3550, { roughness: 0.35 }));
    trackpad.position.set(0, 0.038, 0.09);
    g.add(trackpad);
    var screen = new THREE.Group();
    screen.position.set(0, 0.16, -0.155);
    screen.rotation.x = -1.75;
    screen.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.33, 0.028), body));
    var glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.27),
      new THREE.MeshStandardMaterial({ color: 0x0A0E1A, emissive: 0x53D8C4, emissiveIntensity: 1.1 })
    );
    glow.position.z = 0.018;
    screen.add(glow);
    g.add(screen);
    return g;
  }

  function buildBag(rig) {
    var g = new THREE.Group();
    g.position.set(0.56, 0.95, 0.12);
    g.rotation.z = -0.12;
    var leather = mat(0x8A5A2B, { roughness: 0.75 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.16), leather);
    body.position.y = -0.1;
    g.add(body);
    var flap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.17), mat(0x7A4D24, { roughness: 0.75 }));
    flap.position.set(0, 0.1, 0);
    g.add(flap);
    var strap = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 20, Math.PI), leather);
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.14;
    g.add(strap);
    return g;
  }

  /* ---------------- walk cycle ---------------- */

  function walk(rig, t, speed) {
    var s = Math.sin(t * speed);
    rig.leftLeg.rotation.x = s * 0.55;
    rig.rightLeg.rotation.x = -s * 0.55;
    rig.leftArm.rotation.x = -s * 0.3;
    rig.rightArm.rotation.x = s * 0.3;
    rig.group.position.y = Math.abs(Math.cos(t * speed)) * 0.06;
  }

  function stopWalk(rig) {
    rig.leftLeg.rotation.x = 0;
    rig.rightLeg.rotation.x = 0;
    rig.leftArm.rotation.x = 0;
    rig.rightArm.rotation.x = 0;
    rig.group.position.y = 0;
  }

  /* ---------------- easing ---------------- */

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* ---------------- scene management ---------------- */

  function makeScene(key, canvas, slot) {
    var cfg = SCENE_CFG[key];
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, alpha: true, antialias: true, powerPreference: "low-power"
      });
    } catch (e) {
      return null;
    }
    /* recover gracefully if the browser drops this context (common when several
       are live at once) instead of leaving a frozen avatar */
    canvas.addEventListener("webglcontextlost", function (ev) { ev.preventDefault(); }, false);
    canvas.addEventListener("webglcontextrestored", function () {
      var rec = scenes[key];
      if (rec && rec.s) rec.s.renderer.render(rec.s.scene, rec.s.camera);
    }, false);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    var scene = new THREE.Scene();
    /* sky/ground ambient — enough to lift the suit off the dark page, not so much
       it washes the color out */
    scene.add(new THREE.HemisphereLight(0xBFD2F5, 0x141F38, 0.72));
    var keyLight = new THREE.DirectionalLight(0xFFE7C2, 1.28);
    keyLight.position.set(2.4, 3.4, 2.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.bias = -0.002;
    scene.add(keyLight);
    /* two rim lights (gold + teal) carve the silhouette out of the dark bg */
    var rimTeal = new THREE.DirectionalLight(0x53D8C4, 1.0);
    rimTeal.position.set(-2.6, 1.6, -1.8);
    scene.add(rimTeal);
    var rimGold = new THREE.DirectionalLight(0xE8B34B, 0.7);
    rimGold.position.set(2.2, 0.8, -2.2);
    scene.add(rimGold);
    var fill = new THREE.DirectionalLight(0xDCE8FF, 0.55);
    fill.position.set(-1.5, 1.8, 2.8);
    scene.add(fill);

    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
    /* frame the character's rest position so he's centered in view */
    camera.lookAt(cfg.finalX || 0, cfg.look[1], cfg.look[2]);

    var rig = buildRig();
    rig.group.scale.setScalar(cfg.scale);
    rig.group.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(rig.group);

    /* stage: soft glow + real contact shadow — centered under the character */
    var fx = cfg.finalX || 0;
    var glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 48),
      new THREE.MeshBasicMaterial({ color: 0xE8B34B, transparent: true, opacity: 0.07 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(fx, 0.012, 0);
    scene.add(glow);

    var shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 48),
      new THREE.ShadowMaterial({ opacity: 0.38 })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.set(fx, 0.01, 0);
    shadowDisc.receiveShadow = true;
    scene.add(shadowDisc);

    /* closing scene furniture */
    var furniture = null;
    if (key === "closing") furniture = buildFurniture();

    var state = {
      key: key, canvas: canvas, slot: slot, scene: scene, camera: camera,
      renderer: renderer, rig: rig, furniture: furniture,
      t: 0, active: false, built: false, introDone: false,
      blinkTimer: 2 + Math.random() * 2, blinkPhase: -1,
      accPop: {}, wobble: 0
    };
    return state;
  }

  function buildFurniture() {
    var g = new THREE.Group();
    var wood = mat(0x2A2118, { roughness: 0.65, metalness: 0.05 });
    var cushion = mat(0x1D2A4A, { roughness: 0.8 });

    /* table — rounded top + turned legs */
    var top = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.07, 0.64), wood);
    top.position.set(0, 0.82, 0.95);
    top.castShadow = true; top.receiveShadow = true;
    g.add(top);

    var legGeo = new THREE.CylinderGeometry(0.032, 0.045, 0.8, 14);
    [[-0.52, 0.4], [0.52, 0.4], [-0.52, 1.5], [0.52, 1.5]].forEach(function (p) {
      var leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(p[0], 0.4, p[1]);
      leg.castShadow = true;
      g.add(leg);
    });

    /* chair — seat + visible backrest, cushion (pulled up to the desk) */
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.5), wood);
    seat.position.set(0, 0.52, 0.38);
    seat.castShadow = true; seat.receiveShadow = true;
    g.add(seat);
    var pad = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), cushion);
    pad.position.set(0, 0.59, 0.38);
    g.add(pad);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.07), wood);
    back.position.set(0, 0.92, 0.12);
    back.castShadow = true;
    g.add(back);
    var backPad = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.05), cushion);
    backPad.position.set(0, 0.92, 0.16);
    g.add(backPad);

    var chairLeg = new THREE.CylinderGeometry(0.028, 0.036, 0.5, 12);
    [[-0.2, 0.16], [0.2, 0.16], [-0.2, 0.6], [0.2, 0.6]].forEach(function (p) {
      var leg = new THREE.Mesh(chairLeg, wood);
      leg.position.set(p[0], 0.26, p[1]);
      leg.castShadow = true;
      g.add(leg);
    });

    g.traverse(function (o) { if (o.isMesh) o.receiveShadow = true; });
    return g;
  }

  /* ---------------- choreography ---------------- */

  function setAccessories(state, list) {
    var rig = state.rig;
    var map = { glasses: rig.glasses, laptop: rig.laptop, bag: rig.bag, tie: rig.tie };
    Object.keys(map).forEach(function (name) {
      var obj = map[name];
      var on = list.indexOf(name) !== -1;
      if (on && !obj.visible) { obj.visible = true; state.accPop[name] = 0.001; }
      if (!on) { obj.visible = false; delete state.accPop[name]; }
    });
  }

  function tick(state, dt) {
    state.t += dt;
    var t = state.t;
    var rig = state.rig;
    var cfg = SCENE_CFG[state.key];
    var reduced = prefersReduced;

    /* idle bob + sway */
    if (!reduced && state.introDone) {
      rig.group.position.y = Math.sin(t * 1.5) * 0.03;
      rig.group.rotation.y = Math.sin(t * 0.4) * 0.04;
    }

    /* blink */
    if (!reduced) {
      state.blinkTimer -= dt;
      if (state.blinkTimer <= 0) {
        if (state.blinkPhase < 0) { state.blinkPhase = 0; state.blinkTimer = 0.12; }
        else { state.blinkPhase = -1; state.blinkTimer = 2.2 + Math.random() * 2.4; }
      }
      var es = state.blinkPhase === 0 ? 0.12 : 1;
      rig.eyeL.scale.y = es;
      rig.eyeR.scale.y = es;
    }

    /* choreography */
    if (reduced) {
      if (!state.introDone) {
        state.introDone = true;
        applyFinalPose(state);
      }
    } else {
      runChoreo(state);
    }

    /* accessory pop-in */
    Object.keys(state.accPop).forEach(function (name) {
      var obj = { glasses: rig.glasses, laptop: rig.laptop, bag: rig.bag, tie: rig.tie }[name];
      if (!obj) return;
      state.accPop[name] = Math.min(1, state.accPop[name] + dt * 3.2);
      var s = easeOutBack(state.accPop[name]);
      obj.scale.set(s, s, s);
    });

    state.renderer.render(state.scene, state.camera);
  }

  function runChoreo(state) {
    var t = state.t;
    var rig = state.rig;
    var k = state.key;

    switch (k) {
      case "hero": {
        if (t < 2.8) {
          rig.leftArm.rotation.z = -2.3 + Math.sin(t * 7) * 0.38;
          rig.rightArm.rotation.z = -0.14;
          rig.group.rotation.y = Math.sin(t * 2.2) * 0.18;
        } else {
          state.introDone = true;
          rig.leftArm.rotation.z = 0.14;
          rig.rightArm.rotation.z = -0.14;
          rig.group.rotation.y = 0;
        }
        break;
      }
      case "about": {
        if (!state.introDone) {
          var d = 1.7;
          var p = Math.min(t / d, 1);
          rig.group.position.x = -1.7 + easeInOut(p) * 2.55; /* → 0.85 */
          rig.group.rotation.y = -0.35 * (1 - p);
          walk(rig, t, 9);
          if (p >= 1) { stopWalk(rig); state.introDone = true; rig.group.rotation.y = 0; }
        }
        break;
      }
      case "experience": {
        if (!state.introDone) {
          var d2 = 2.1;
          var p2 = Math.min(t / d2, 1);
          rig.group.position.x = -1.35 + easeInOut(p2) * 1.9; /* → 0.55 */
          rig.group.rotation.y = -0.4 * (1 - p2);
          walk(rig, t, 8);
          if (rig.group.position.x > -0.7 && !rig.glasses.visible) {
            rig.glasses.visible = true;
            state.accPop.glasses = 0.001;
          }
          if (p2 >= 1) {
            stopWalk(rig);
            state.introDone = true;
            rig.group.rotation.y = 0;
            rig.leftArm.rotation.z = -0.9; /* gesture to the timeline */
          }
        }
        break;
      }
      case "projects": {
        if (!state.introDone) {
          setAccessories(state, ["glasses"]);
          if (t < 0.6) {
            rig.bag.visible = true;
            state.accPop.bag = 0.001;
            rig.leftArm.rotation.z = 0.4;
          } else if (t < 1.6) {
            /* laptop rises out of the bag */
            rig.bag.visible = true;
            rig.laptop.visible = true;
            var lp = Math.min((t - 0.6) / 1.0, 1);
            rig.laptop.position.y = 0.55 + easeInOut(lp) * 0.47;
            rig.laptop.position.x = 0.56 - easeInOut(lp) * 0.24;
            rig.laptop.scale.setScalar(0.4 + 0.6 * easeOutBack(lp));
            rig.rightArm.rotation.z = -0.2 - 0.15 * lp;
          } else {
            rig.laptop.visible = true;
            rig.laptop.position.set(0.32, 1.02, 0.42);
            rig.laptop.scale.set(1, 1, 1);
            rig.bag.visible = true;
            rig.rightArm.rotation.z = -0.35;
            rig.rightArm.rotation.x = 0.25;
            rig.leftArm.rotation.z = 0.14;
            state.introDone = true;
          }
        }
        break;
      }
      case "skills": {
        if (!state.introDone) {
          state.introDone = true;
          rig.glasses.visible = true;
          rig.laptop.visible = true;
          rig.laptop.position.set(0.32, 1.02, 0.42);
          rig.rightArm.rotation.z = -0.35;
          rig.rightArm.rotation.x = 0.25;
          rig.leftArm.rotation.z = -0.85; /* pointing at the grid */
        }
        break;
      }
      case "closing": {
        if (!state.introDone) {
          var walkT = 1.5;
          if (t < walkT) {
            var wp = t / walkT;
            rig.group.position.x = -1.6 + easeInOut(wp) * 1.6;
            rig.group.rotation.y = -0.4 * (1 - wp);
            walk(rig, t, 9);
          } else if (t < walkT + 0.9) {
            stopWalk(rig);
            var sp = (t - walkT) / 0.9;
            rig.group.scale.setScalar(SCENE_CFG.closing.scale * (1 - 0.06 * easeInOut(sp)));
            rig.group.position.y = easeInOut(sp) * -0.42;
            rig.group.rotation.y = 0;
          } else {
            /* seated: shirt & tie, laptop on the table */
            state.introDone = true;
            rig.group.scale.setScalar(0.8);
            rig.group.position.set(0, 0.12, 0.35);   /* hips on the seat */
            rig.group.rotation.y = 0;
            rig.leftLeg.visible = false;             /* legs hidden behind the desk */
            rig.rightLeg.visible = false;
            rig.suitTorso.visible = false;
            rig.badge.visible = false;
            rig.collarSuit.visible = false;
            rig.shirtTorso.visible = true;
            rig.collarShirt.visible = true;
            rig.tie.visible = true;
            state.accPop.tie = 0.001;
            rig.glasses.visible = false;
            /* laptop onto the tabletop, near the desk edge */
            state.scene.add(rig.laptop);
            rig.laptop.position.set(0, 0.877, 0.72);
            rig.laptop.scale.set(0.9, 0.9, 0.9);
            rig.laptop.rotation.y = 0;
            rig.laptop.visible = true;
            rig.leftArm.rotation.z = 0.3;  rig.leftArm.rotation.x = -0.75;
            rig.rightArm.rotation.z = -0.3; rig.rightArm.rotation.x = -0.75;
            rig.head.rotation.y = 0.1;     rig.head.rotation.x = 0.04;
            state.tableLaptop = true;
          }
        }
        if (state.tableLaptop) {
          rig.laptop.visible = true;
          rig.leftArm.rotation.z = 0.25;
          rig.rightArm.rotation.z = -0.25;
          rig.head.rotation.y = 0.12; /* eye contact */
          rig.head.rotation.x = 0.05;
        }
        break;
      }
    }
  }

  function applyFinalPose(state) {
    /* reduced-motion: jump straight to the end state */
    var rig = state.rig;
    var k = state.key;
    rig.group.position.x = 0;
    if (k === "experience") { rig.glasses.visible = true; rig.group.position.x = 0.55; rig.leftArm.rotation.z = -0.9; }
    if (k === "about") rig.group.position.x = 0.85;
    if (k === "projects") {
      setAccessories(state, ["glasses", "laptop", "bag"]);
      rig.rightArm.rotation.z = -0.35; rig.rightArm.rotation.x = 0.25;
    }
    if (k === "skills") {
      rig.glasses.visible = true; rig.laptop.visible = true;
      rig.rightArm.rotation.z = -0.35; rig.rightArm.rotation.x = 0.25;
      rig.leftArm.rotation.z = -0.85;
    }
    if (k === "closing") {
      rig.group.position.set(0, 0.12, 0.35);
      rig.group.scale.setScalar(0.8);
      rig.leftLeg.visible = false; rig.rightLeg.visible = false;
      rig.suitTorso.visible = false; rig.badge.visible = false;
      rig.collarSuit.visible = false;
      rig.shirtTorso.visible = true; rig.collarShirt.visible = true; rig.tie.visible = true;
      state.scene.add(rig.laptop);
      rig.laptop.visible = true; rig.laptop.position.set(0, 0.877, 0.72);
      rig.laptop.scale.set(0.9, 0.9, 0.9); rig.laptop.rotation.y = 0;
      rig.leftArm.rotation.z = 0.3; rig.leftArm.rotation.x = -0.75;
      rig.rightArm.rotation.z = -0.3; rig.rightArm.rotation.x = -0.75;
      rig.head.rotation.y = 0.1; rig.head.rotation.x = 0.04;
    }
    setAccessories(state, ACCESSORY_MAP[k]);
  }

  /* ---------------- loop ---------------- */

  var last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; } /* don't burn GPU on a hidden tab */
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    Object.keys(scenes).forEach(function (key) {
      var r = scenes[key];
      if (r && r.s && r.s.active) tick(r.s, dt); /* r.s.active is the flag setActive() sets */
    });
  }

  /* ---------------- fallback (flat avatar) ---------------- */

  function setupFallback() {
    fallbackMode = true;
    var template = document.querySelector('[data-fb-avatar]');
    document.querySelectorAll("[data-fallback]").forEach(function (slot) {
      if (!template) return;
      var key = slot.getAttribute("data-fallback");
      /* the hero slot already holds the template SVG — don't clone a second one on top */
      if (!slot.querySelector("svg")) slot.appendChild(template.cloneNode(true));
      slot.hidden = false;
      applyFallbackAccessories(slot, key);
    });
  }

  function applyFallbackAccessories(slot, key) {
    var list = ACCESSORY_MAP[key] || [];
    ["glasses", "laptop", "bag", "tie"].forEach(function (name) {
      var el = slot.querySelector(".fb-" + name);
      if (el) el.hidden = list.indexOf(name) === -1;
    });
  }

  function ensureFallback(slot, key) {
    if (!slot) return;
    var fb = slot.querySelector("[data-fallback]");
    if (!fb || !fb.hidden) return;
    var template = document.querySelector("[data-fb-avatar]");
    if (template) fb.appendChild(template.cloneNode(true));
    fb.hidden = false;
    applyFallbackAccessories(fb, key);
  }

  /* ---------------- public API ---------------- */

  window.AvatarScenes = {
    setActive: function (key) {
      activeKey = key;
      if (fallbackMode) {
        document.querySelectorAll("[data-fallback]").forEach(function (slot) {
          slot.hidden = slot.getAttribute("data-fallback") !== key;
        });
        return;
      }
      var rec = scenes[key];
      if (!rec) return;
      Object.keys(scenes).forEach(function (k) {
        var r = scenes[k];
        if (r && r.s) r.s.active = k === key;
      });
      /* build the renderer lazily on first activation */
      if (!rec.built) {
        rec.built = true;
        var s = makeScene(key, rec.canvas, rec.slot);
        if (!s) { ensureFallback(rec.slot, key); return; }
        s.resize = function () {
          var w = rec.canvas.clientWidth || 300;
          var h = rec.canvas.clientHeight || 300;
          s.renderer.setSize(w, h, false);
          s.camera.aspect = w / h;
          s.camera.updateProjectionMatrix();
        };
        s.resize();
        if (window.ResizeObserver) new ResizeObserver(s.resize).observe(rec.canvas);
        else window.addEventListener("resize", s.resize);
        if (s.furniture) s.scene.add(s.furniture);
        setAccessories(s, ACCESSORY_MAP[key]);
        rec.s = s;
      }
      if (rec.s) rec.s.active = true;
    },
    init: function () {
      if (!window.THREE) { setupFallback(); return; }
      /* avatar + bubbles are hidden on mobile/tablet (CSS) — skip building
         WebGL scenes there entirely to save memory and battery */
      if (window.innerWidth < 921) return;
      document.querySelectorAll("canvas[data-scene]").forEach(function (canvas) {
        var key = canvas.getAttribute("data-scene");
        scenes[key] = {
          canvas: canvas,
          slot: canvas.closest("[data-slot]") || null,
          key: key, built: false, active: false, s: null
        };
      });
      requestAnimationFrame(loop);
    }
  };

  window.AvatarScenes.init();
  /* signal readiness — this file may load after main.js has already picked the
     first visible scene, so let main.js (re)activate it now that we exist */
  window.dispatchEvent(new Event("avatar:ready"));
})();
