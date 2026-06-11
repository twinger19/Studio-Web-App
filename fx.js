/* ═══════════════════════════════════════════════════════════════
   STUDIO W — FX LAYER (GSAP motion + Three.js aurora backdrop)
   Loaded after app.js. Purely additive:
   · If GSAP/Three fail to load (offline), the app works untouched.
   · Honors prefers-reduced-motion.
   · Hooks the existing render pipeline by wrapping globals —
     zero changes to app logic.
   ═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

var PRM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var hasGSAP = typeof window.gsap !== 'undefined';
var hasTHREE = typeof window.THREE !== 'undefined';

/* ────────────────────────────────────────────────────────────────
   1 · AURORA — full-screen shader backdrop (Three.js)
   ──────────────────────────────────────────────────────────────── */
function isDark(){
  var t = document.documentElement.getAttribute('data-theme');
  return t==='dark' || (t==='system' && document.documentElement.classList.contains('sys-dark'));
}

function initAurora(){
  if(!hasTHREE) return;
  try{
    var canvas = document.createElement('canvas');
    canvas.id = 'fxAurora';
    document.body.insertBefore(canvas, document.body.firstChild);

    var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:false, alpha:false, powerPreference:'low-power'});
    var DPR = Math.min(window.devicePixelRatio||1, 1.5);
    renderer.setPixelRatio(DPR);
    renderer.setSize(window.innerWidth, window.innerHeight);

    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

    var uniforms = {
      uTime:  {value:0},
      uRes:   {value:new THREE.Vector2(window.innerWidth, window.innerHeight)},
      uMouse: {value:new THREE.Vector2(0.5,0.5)},
      uBase:  {value:new THREE.Color(0x08080D)},
      uC1:    {value:new THREE.Color(0x5B43F0)},   // iris
      uC2:    {value:new THREE.Color(0x1B0F66)},   // deep indigo
      uC3:    {value:new THREE.Color(0x16707E)},   // teal ember
      uC4:    {value:new THREE.Color(0x8F2450)},   // magenta ash
      uAmp:   {value:1.0}
    };

    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      depthTest:false, depthWrite:false,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'precision highp float;',
        'uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse;',
        'uniform vec3 uBase, uC1, uC2, uC3, uC4; uniform float uAmp;',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
        'float noise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p);',
        '  vec2 u = f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x),',
        '             mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);',
        '}',
        'float fbm(vec2 p){',
        '  float v = 0.0, a = 0.5;',
        '  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);',
        '  for(int i=0;i<5;i++){ v += a*noise(p); p = r*p*2.05; a *= 0.52; }',
        '  return v;',
        '}',
        'void main(){',
        '  vec2 uv = gl_FragCoord.xy / uRes.xy;',
        '  vec2 p = uv; p.x *= uRes.x/uRes.y;',
        '  float t = uTime*0.045;',
        '  vec2 drift = (uMouse-0.5)*0.18;',
        '  float n1 = fbm(p*1.35 + vec2(t*0.7, -t*0.4) + drift);',
        '  float n2 = fbm(p*2.1 - vec2(t*0.5, t*0.3) + n1*0.9);',
        '  float n3 = fbm(p*0.8 + vec2(-t*0.3, t*0.55) + n2*0.6);',
        '  vec3 col = uBase;',
        '  col += uC2 * smoothstep(0.30, 0.95, n3) * 0.60;',
        '  col += uC1 * smoothstep(0.45, 0.98, n1) * 0.48;',
        '  col += uC3 * smoothstep(0.58, 1.00, n2) * 0.26;',
        '  col += uC4 * smoothstep(0.64, 1.00, fbm(p*1.7+vec2(t*0.25,-t*0.6))) * 0.20;',
        '  col = mix(uBase, col, uAmp);',
        '  float vig = smoothstep(1.35, 0.30, length(uv-vec2(0.5,0.42)));',
        '  col *= mix(0.5, 1.0, vig);',
        '  col += (hash(gl_FragCoord.xy*0.7) - 0.5) * 0.012;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));

    function applyAuroraTheme(){
      if(isDark()){
        uniforms.uBase.value.set(0x08080D);
        uniforms.uC1.value.set(0x5B43F0);
        uniforms.uC2.value.set(0x1B0F66);
        uniforms.uC3.value.set(0x16707E);
        uniforms.uC4.value.set(0x8F2450);
        uniforms.uAmp.value = 1.0;
      } else {
        uniforms.uBase.value.set(0xF3F1EC);
        uniforms.uC1.value.set(0xCFC5FF);
        uniforms.uC2.value.set(0xBFD4F2);
        uniforms.uC3.value.set(0xCBEADF);
        uniforms.uC4.value.set(0xF6D3D9);
        uniforms.uAmp.value = 0.85;
      }
    }
    applyAuroraTheme();
    new MutationObserver(applyAuroraTheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme','class']});

    var mouse = {x:0.5, y:0.5}, target = {x:0.5, y:0.5};
    window.addEventListener('pointermove', function(e){
      target.x = e.clientX / window.innerWidth;
      target.y = 1 - e.clientY / window.innerHeight;
    }, {passive:true});

    window.addEventListener('resize', function(){
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
    });

    var start = performance.now();
    function frame(){
      if(!document.hidden){
        mouse.x += (target.x-mouse.x)*0.04;
        mouse.y += (target.y-mouse.y)*0.04;
        uniforms.uMouse.value.set(mouse.x, mouse.y);
        uniforms.uTime.value = (performance.now()-start)/1000;
        renderer.render(scene, camera);
      }
      if(!PRM) requestAnimationFrame(frame);
    }
    if(PRM){
      // Static painterly frame — no motion
      uniforms.uTime.value = 12.0;
      renderer.render(scene, camera);
    } else {
      requestAnimationFrame(frame);
    }
  }catch(e){ /* WebGL unavailable — CSS fallback gradient remains */ }
}

/* ────────────────────────────────────────────────────────────────
   2 · FILM GRAIN
   ──────────────────────────────────────────────────────────────── */
function initGrain(){
  var g = document.createElement('div');
  g.className = 'fx-grain';
  g.setAttribute('aria-hidden','true');
  document.body.appendChild(g);
}

/* ────────────────────────────────────────────────────────────────
   3 · CINEMATIC INTRO — plays once per session, after unlock
   ──────────────────────────────────────────────────────────────── */
var introDone = false;
function playIntro(){
  if(introDone) return; introDone = true;
  if(!hasGSAP || PRM){ revealShell(false); return; }
  var played = false;
  try{ played = sessionStorage.getItem('fxIntroPlayed')==='1'; }catch(e){}
  if(played){ revealShell(true); return; }
  try{ sessionStorage.setItem('fxIntroPlayed','1'); }catch(e){}

  var ov = document.createElement('div');
  ov.className = 'fx-intro';
  var word = 'Studio W';
  var chars = '';
  for(var i=0;i<word.length;i++){
    var c = word[i];
    chars += '<span class="ch'+(c==='W'?' it':'')+'">'+(c===' '?'&nbsp;':c)+'</span>';
  }
  ov.innerHTML =
    '<div class="fx-intro-logo">'+chars+'</div>'+
    '<div class="fx-intro-line"><i></i></div>'+
    '<div class="fx-intro-sub"><span>Tasks &middot; Notes &middot; Momentum</span></div>';
  document.body.appendChild(ov);

  try{
    var tl = gsap.timeline({
      defaults:{ease:'power4.out'},
      onComplete:function(){ ov.remove(); }
    });
    tl.from(ov.querySelectorAll('.fx-intro-logo .ch'), {yPercent:118, rotate:6, duration:0.95, stagger:0.045})
      .to(ov.querySelector('.fx-intro-line i'), {scaleX:1, duration:0.8, ease:'expo.inOut'}, '-=0.5')
      .from(ov.querySelector('.fx-intro-sub span'), {yPercent:110, autoAlpha:0, duration:0.6}, '-=0.55')
      .to({}, {duration:0.45})
      .to(ov, {yPercent:-100, duration:0.85, ease:'expo.inOut'})
      .add(function(){ revealShell(true); }, '-=0.45');
  }catch(e){ ov.remove(); revealShell(false); }
}

function revealShell(animate){
  if(!animate || !hasGSAP || PRM){ animateView(); return; }
  try{
    gsap.from('#sidebar', {x:-30, autoAlpha:0, duration:0.8, ease:'power3.out', clearProps:'all'});
    gsap.from('.topbar', {y:-16, autoAlpha:0, duration:0.7, ease:'power3.out', delay:0.08, clearProps:'all'});
    gsap.from('.quick-fab,.chat-fab', {y:24, autoAlpha:0, duration:0.7, ease:'back.out(1.6)', delay:0.35, stagger:0.08, clearProps:'opacity,visibility,transform'});
  }catch(e){}
  animateView();
}

/* Watch the lock screen — intro fires the moment the app is revealed */
function armIntro(){
  var lock = document.getElementById('lockScreen');
  if(!lock){ playIntro(); return; }
  function check(){
    if(getComputedStyle(lock).display==='none'){ playIntro(); return true; }
    return false;
  }
  if(check()) return;
  // Lock screen visible — give it its own entrance
  if(hasGSAP && !PRM){
    try{
      gsap.from('.lock-box > *', {y:26, autoAlpha:0, duration:0.85, ease:'power3.out', stagger:0.07, clearProps:'all'});
    }catch(e){}
  }
  new MutationObserver(function(_, obs){
    if(check()) obs.disconnect();
  }).observe(lock, {attributes:true, attributeFilter:['style']});
}

/* ────────────────────────────────────────────────────────────────
   4 · VIEW TRANSITIONS — staggered entrances on real view change
   ──────────────────────────────────────────────────────────────── */
var lastSig = null, lastAnim = 0;

function viewSig(){
  try{
    var s = (typeof viewMode!=='undefined'?viewMode:'') + '|' +
            (typeof homeView!=='undefined'?homeView:'') + '|' +
            (typeof selId!=='undefined'?(selId||''):'') + '|';
    if(typeof viewScope!=='undefined' && viewScope) s += viewScope.type + (viewScope.id||'');
    return s;
  }catch(e){ return ''; }
}

var VIEW_SELECTORS = ['.dash2-head','.dash2-nudges','.bento-tile','.tb-col','.wl-toolbar',
  '.wl-scope-chips','.wl-group','.note-card','.stat-card','.cal-agenda-day','.cal-grid',
  '.cal-toolbar','.empty','.links-hub > *','.sync-panel > *','.dash-panel'].join(',');

function animateView(){
  if(!hasGSAP || PRM) return;
  var now = Date.now();
  if(now - lastAnim < 250) return;   // debounce double-fires (intro + first render)
  var c = document.getElementById('mainContent');
  if(!c) return;
  var els = Array.prototype.slice.call(c.querySelectorAll(VIEW_SELECTORS), 0, 26);
  if(!els.length) return;
  lastAnim = now;
  try{
    gsap.fromTo(els,
      {autoAlpha:0, y:26},
      {autoAlpha:1, y:0, duration:0.65, ease:'power3.out', stagger:0.05,
       overwrite:'auto', clearProps:'opacity,visibility,transform'});
  }catch(e){}
  countUp(c);
}

/* Animated counters on the bento home */
function countUp(scope){
  if(!hasGSAP || PRM) return;
  try{
    scope.querySelectorAll('.bento-stat b, .bento-pill').forEach(function(el){
      var n = parseInt(el.textContent, 10);
      if(isNaN(n) || n<=0 || n>9999) return;
      var o = {v:0};
      gsap.to(o, {v:n, duration:0.9, ease:'power2.out', delay:0.15,
        onUpdate:function(){ el.textContent = Math.round(o.v); }});
    });
  }catch(e){}
}

/* ────────────────────────────────────────────────────────────────
   5 · HOOKS — wrap the app's render/open functions
   ──────────────────────────────────────────────────────────────── */
function wrap(name, after){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var r = orig.apply(this, arguments);
    try{ after.apply(this, arguments); }catch(e){}
    return r;
  };
}

function popIn(sel, fromVars, dur, ease){
  if(!hasGSAP || PRM) return;
  var el = document.querySelector(sel);
  if(!el || getComputedStyle(el).display==='none') return;
  try{
    gsap.fromTo(el, fromVars, {x:0, y:0, scale:1, autoAlpha:1,
      duration:dur||0.4, ease:ease||'power3.out', overwrite:'auto',
      clearProps:'opacity,visibility,transform'});
  }catch(e){}
}

function installHooks(){
  wrap('renderMain', function(){
    var s = viewSig();
    if(s !== lastSig){ lastSig = s; animateView(); }
  });
  wrap('openProjectModal', function(){
    if(!hasGSAP || PRM) return;
    try{
      gsap.fromTo('#projSheetOv', {autoAlpha:0}, {autoAlpha:1, duration:0.3, ease:'power2.out', clearProps:'opacity,visibility'});
      gsap.fromTo('#projSheet', {y:46, scale:0.975, autoAlpha:0},
        {y:0, scale:1, autoAlpha:1, duration:0.55, ease:'expo.out', clearProps:'opacity,visibility,transform'});
    }catch(e){}
  });
  wrap('openModal', function(){ popIn('.modal-box', {scale:0.94, y:14, autoAlpha:0}, 0.38, 'back.out(1.4)'); });
  wrap('openCmdBar', function(){ popIn('.cmdbar-box', {y:-18, autoAlpha:0}, 0.32); });
  wrap('openSearch', function(){ popIn('.search-box', {y:-14, scale:0.985, autoAlpha:0}, 0.32); });
  wrap('toggleChat', function(){
    var p = document.getElementById('chatPanel');
    if(p && getComputedStyle(p).display!=='none' && (p.classList.contains('open') || p.offsetParent !== null)){
      popIn('#chatPanel', {x:34, autoAlpha:0}, 0.45, 'expo.out');
    }
  });
}

/* ────────────────────────────────────────────────────────────────
   6 · MAGNETIC FLOATING ACTIONS
   ──────────────────────────────────────────────────────────────── */
function magnetize(el, strength){
  if(!el || !hasGSAP || PRM || !window.matchMedia('(pointer:fine)').matches) return;
  var xTo = gsap.quickTo(el, 'x', {duration:0.35, ease:'power3.out'});
  var yTo = gsap.quickTo(el, 'y', {duration:0.35, ease:'power3.out'});
  el.addEventListener('pointermove', function(e){
    var r = el.getBoundingClientRect();
    xTo((e.clientX - (r.left + r.width/2)) * strength);
    yTo((e.clientY - (r.top + r.height/2)) * strength);
  });
  el.addEventListener('pointerleave', function(){
    gsap.to(el, {x:0, y:0, duration:0.7, ease:'elastic.out(1, 0.4)'});
  });
}

/* ────────────────────────────────────────────────────────────────
   7 · CARD TILT — subtle 3D response on board cards & bento tiles
   ──────────────────────────────────────────────────────────────── */
var tilted = (typeof WeakSet!=='undefined') ? new WeakSet() : null;
function initTilt(){
  if(!hasGSAP || PRM || !tilted || !window.matchMedia('(pointer:fine)').matches) return;
  document.addEventListener('pointerover', function(e){
    var card = e.target.closest && e.target.closest('.tb-card,.bento-tile');
    if(!card || tilted.has(card)) return;
    tilted.add(card);
    card.addEventListener('pointermove', function(ev){
      var r = card.getBoundingClientRect();
      var rx = ((ev.clientY - r.top)/r.height - 0.5) * -3.2;
      var ry = ((ev.clientX - r.left)/r.width - 0.5) * 3.2;
      gsap.to(card, {rotateX:rx, rotateY:ry, y:-2, transformPerspective:700,
        duration:0.4, ease:'power2.out', overwrite:'auto'});
    });
    card.addEventListener('pointerleave', function(){
      gsap.to(card, {rotateX:0, rotateY:0, y:0, duration:0.55, ease:'power3.out',
        overwrite:'auto', clearProps:'transform'});
    });
  }, {passive:true});
}

/* ────────────────────────────────────────────────────────────────
   BOOT
   ──────────────────────────────────────────────────────────────── */
function boot(){
  initAurora();
  initGrain();
  installHooks();
  magnetize(document.getElementById('quickFab'), 0.28);
  magnetize(document.getElementById('chatFab'), 0.35);
  initTilt();
  armIntro();
  lastSig = viewSig();
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
})();
