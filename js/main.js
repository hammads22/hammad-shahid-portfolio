/* ============================================================
   Portfolio interactions — nav, scroll-driven scene switching,
   quick speech bubbles (no voice), stats, reveals
   ============================================================ */

(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Lines per section — the avatar's tour of the page */
  var LINES = {
    hero: "Hey there — I'm Hammad. Welcome to my portfolio. Scroll down, and I'll walk you through it.",
    about: "I work both sides of the table: discovery workshops with stakeholders in the morning, Apex and LWC in the afternoon.",
    experience: "Time to put on the consulting glasses. Fintech and government projects — an FSC loan origination system built for a billion dollars a month in pipeline.",
    projects: "And here's what I've actually built — the laptop's out, let me show you around.",
    skills: "The toolkit: Sales, Service, Experience and Data Cloud, CPQ and Revenue Cloud, Agentforce — plus a Data Science MSc.",
    closing: "Anyone can build with AI these days. But AI can't take accountability. When you work with me, someone owns the outcome. I do."
  };

  /* ---------------- Scene switching (scroll-driven) ---------------- */

  var activeScene = null;
  var bubbleTimer = null;
  var typingIv = null;
  var lastJobLine = null;
  var srLive = document.querySelector(".sr-live");

  /* avatar.js may finish loading after we've already chosen the first visible
     scene — re-apply it once the avatar engine announces it's ready */
  window.addEventListener("avatar:ready", function () {
    if (activeScene && window.AvatarScenes) window.AvatarScenes.setActive(activeScene);
  });

  function activateScene(key) {
    if (activeScene === key) return;
    activeScene = key;
    if (key !== "experience") lastJobLine = null;

    if (window.AvatarScenes) window.AvatarScenes.setActive(key);

    /* announce the line once to screen readers — the visible bubble types it
       out char-by-char and is aria-hidden, so this avoids per-character spam */
    if (srLive) srLive.textContent = LINES[key] || "";

    /* stop any in-flight typewriter before switching */
    if (typingIv) { clearInterval(typingIv); typingIv = null; }

    /* show only this section's bubble */
    document.querySelectorAll("[data-bubble]").forEach(function (b) {
      var isThis = b.getAttribute("data-bubble") === key;
      b.hidden = !isThis;
      if (isThis) typeBubble(b, LINES[key] || "");
    });

    /* auto-hide the bubble so it never lingers over content */
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      document.querySelectorAll("[data-bubble]").forEach(function (b) { b.hidden = true; });
    }, 8000);
  }

  function typeBubble(bubble, text) {
    var p = bubble.querySelector("p");
    if (!p) return;
    /* cancel any in-flight typewriter — two timers writing the same <p>
       fight each other and the text can never settle (the reported bug) */
    if (typingIv) { clearInterval(typingIv); typingIv = null; }
    p.textContent = "";
    /* clear any viewport-clamp offsets from a previous showing */
    bubble.style.marginTop = "";
    bubble.style.marginLeft = "";
    if (prefersReduced) { p.textContent = text; clampBubble(); return; }
    var i = 0;
    typingIv = setInterval(function () {
      i++;
      p.textContent = text.slice(0, i);
      clampBubble();
      /* keep the newest typed line visible if the bubble ever scrolls */
      bubble.scrollTop = bubble.scrollHeight;
      if (i >= text.length) { clearInterval(typingIv); typingIv = null; }
    }, 12);
  }

  /* ---------------- Speech-bubble viewport clamp ----------------
     The bubble is absolutely positioned above its slot, so on short viewports,
     inside the pinned Experience slot, or near the fixed nav/contact bars it
     can extend past the viewport and get visually clipped (the CSS sticky
     offset reserves headroom, but scrolling/resizing can still push it out).
     Measure it and nudge it back inside with margin offsets — the
     translateX(-50%) transform and sticky positioning are left untouched. */
  var BUBBLE_TOP = 72;    /* fixed nav (64px) + breathing room */
  var BUBBLE_BOTTOM = 72; /* fixed contact bar + breathing room */
  var BUBBLE_SIDE = 12;
  var clampScheduled = false;

  function clampBubbleNow() {
    var bubble = document.querySelector("[data-bubble]:not([hidden])");
    if (!bubble) return;
    var r = bubble.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var dx = 0, dy = 0;
    if (r.left < BUBBLE_SIDE) dx = BUBBLE_SIDE - r.left;
    if (r.right > vw - BUBBLE_SIDE) dx = Math.min(dx, (vw - BUBBLE_SIDE) - r.right);
    if (r.top < BUBBLE_TOP) dy = BUBBLE_TOP - r.top;
    if (r.bottom > vh - BUBBLE_BOTTOM) dy = Math.min(dy, (vh - BUBBLE_BOTTOM) - r.bottom);
    bubble.style.marginLeft = dx ? dx + "px" : "";
    bubble.style.marginTop = dy ? dy + "px" : "";
  }

  /* rAF-throttled so scroll/resize/typing can all call it freely */
  function clampBubble() {
    if (clampScheduled) return;
    clampScheduled = true;
    requestAnimationFrame(function () {
      clampScheduled = false;
      clampBubbleNow();
    });
  }

  window.addEventListener("scroll", clampBubble, { passive: true });
  window.addEventListener("resize", clampBubble);

  var sections = Array.prototype.slice.call(document.querySelectorAll("[data-scene]"));

  if ("IntersectionObserver" in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.35) {
          activateScene(entry.target.getAttribute("data-scene"));
        }
      });
    }, { threshold: [0.35, 0.55] });
    sections.forEach(function (s) { io.observe(s); });
  } else if (sections.length) {
    activateScene(sections[0].getAttribute("data-scene"));
  }

  /* ---------------- Per-job narration (Experience) ----------------
     As each job entry scrolls into view, the avatar's bubble switches to a
     line about that specific experience — the "dynamic text" tied to the
     job you're looking at. */
  var jobs = Array.prototype.slice.call(document.querySelectorAll(".job[data-line]"));

  function showExperienceJobLine(line) {
    if (!line || line === lastJobLine) return;
    lastJobLine = line;
    var bubble = document.querySelector('[data-bubble="experience"]');
    if (!bubble) return;
    bubble.hidden = false;
    typeBubble(bubble, line);
    if (srLive) srLive.textContent = line;
    /* restart the auto-hide timer */
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      document.querySelectorAll("[data-bubble]").forEach(function (b) { b.hidden = true; });
    }, 8000);
  }

  if ("IntersectionObserver" in window && jobs.length) {
    var jobIo = new IntersectionObserver(function (entries) {
      if (activeScene !== "experience") return;
      var best = null, bestRatio = 0;
      entries.forEach(function (e) {
        if (e.isIntersecting && e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          best = e.target;
        }
      });
      if (best) showExperienceJobLine(best.getAttribute("data-line"));
    }, { threshold: [0.25, 0.5, 0.75] });
    jobs.forEach(function (j) { jobIo.observe(j); });
  }

  /* ---------------- Mobile nav ---------------- */

  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    links.id = "nav-links";
    toggle.setAttribute("aria-controls", "nav-links");
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && links.querySelector("a")) links.querySelector("a").focus();
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("open")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ---------------- Count-up stats ---------------- */

  var stats = document.querySelectorAll(".stat-num");
  var heroStats = document.querySelector(".hero-stats");
  if (stats.length && heroStats && !prefersReduced && "IntersectionObserver" in window) {
    var ioStats = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        ioStats.disconnect();
        stats.forEach(animateStat);
      });
    }, { threshold: 0.4 });
    ioStats.observe(heroStats);
  }

  function animateStat(el) {
    var target = parseInt(el.dataset.count, 10) || 0;
    var prefix = el.dataset.prefix || "";
    var suffix = el.dataset.suffix || "";
    var dur = 1200;
    var start = null;
    el.textContent = prefix + "0" + suffix;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- Reveal on scroll ---------------- */

  var revealables = document.querySelectorAll(".section-head, .about-grid, .projects-intro, .skills-layout, .timeline, .project-grid, .closing-inner, .hero-stats");
  if (revealables.length && !prefersReduced && "IntersectionObserver" in window) {
    revealables.forEach(function (el) { el.classList.add("reveal"); });
    var ioReveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          ioReveal.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    revealables.forEach(function (el) { ioReveal.observe(el); });
  }

  /* ---------------- Footer year ---------------- */

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------------- Resume download counter ----------------
     Free counter service (counterapi.dev) — increments on every resume
     download click and shows the total in the footer. Fails silently. */
  var DL_API = "https://api.counterapi.dev/v1/hammadshahid/resume";

  function bumpDownload() {
    try { fetch(DL_API + "/up", { method: "POST" }).catch(function () {}); } catch (e) {}
  }
  function refreshDownloadCount() {
    var el = document.getElementById("dl-count");
    if (!el) return;
    try {
      fetch(DL_API)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && typeof d.count === "number") el.textContent = d.count;
        })
        .catch(function () { el.textContent = "–"; });
    } catch (e) { el.textContent = "–"; }
  }
  document.querySelectorAll("a[download]").forEach(function (a) {
    a.addEventListener("click", bumpDownload);
  });
  refreshDownloadCount();
})();
