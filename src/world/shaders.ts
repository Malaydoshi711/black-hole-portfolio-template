/* GLSL for the black hole. Units: Schwarzschild radius rs = 1, so the photon
 * sphere sits at r = 1.5, the ISCO (inner disk edge) at r = 3 and the shadow
 * edge at impact parameter b = 3*sqrt(3)/2 = 2.598.
 *
 * Rays are traced backwards from the camera. Light bending uses the classic
 * Cartesian form of the Schwarzschild null geodesic, a = -1.5 h^2 x / r^5,
 * which reproduces the Binet equation u'' + u = 1.5 u^2 exactly. Rays that
 * never come near the hole skip the march and use the analytic weak-field
 * deflection instead, which is what keeps most of the screen cheap. */

export const MAX_BODIES = 12;

export const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const holeFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
  uniform float uTanHalf, uAspect;
  uniform vec2 uShift;
  uniform float uDiskTime;
  uniform float uTime;
  uniform int uMaxSteps;
  uniform float uStepScale;
  uniform float uPixAngle;
  uniform float uDiskGain, uStarGain, uRingGain, uStarDim;
  uniform vec3 uGalN;

  uniform vec4 uBody[${MAX_BODIES}];      // xyz centre, w radius
  uniform vec4 uBodyCol[${MAX_BODIES}];   // rgb colour, a emissive 0..1
  uniform vec4 uBodyInfo[${MAX_BODIES}];  // x kind (0 planet, 1 star, 2 pulsar), y highlight, z seed, w glow
  uniform vec4 uBodyAxis[${MAX_BODIES}];  // xyz pulsar beam axis / planet spin axis, w beam strength
  uniform int uBodyCount;

  #define RIN 3.0
  #define ROUT 11.0
  #define BCRIT 2.5980762
  #define TAU 6.2831853

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

  // value noise, periodic in x with period P (so the disk wraps without a seam)
  float pnoise(vec2 p, float P) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float i0 = mod(i.x, P), i1 = mod(i.x + 1.0, P);
    float a = hash12(vec2(i0, i.y)), b = hash12(vec2(i1, i.y));
    float c = hash12(vec2(i0, i.y + 1.0)), d = hash12(vec2(i1, i.y + 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float pfbm(vec2 p, float P) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * pnoise(p, P); p = p * 2.03 + vec2(0.0, 1.7); P *= 2.0; a *= 0.5; }
    return s;
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash33(i).x, n100 = hash33(i + vec3(1,0,0)).x, n010 = hash33(i + vec3(0,1,0)).x, n110 = hash33(i + vec3(1,1,0)).x;
    float n001 = hash33(i + vec3(0,0,1)).x, n101 = hash33(i + vec3(1,0,1)).x, n011 = hash33(i + vec3(0,1,1)).x, n111 = hash33(i + vec3(1,1,1)).x;
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  }

  #define RSTART 19.0       // march only inside this sphere; outside it the bend is analytic
  #define SEAM 3.0          // width (in b) of the blend from marched to analytic bending

  // white-hot gold palette, indexed by observed temperature
  vec3 heat(float t) {
    vec3 c = mix(vec3(0.20, 0.025, 0.005), vec3(0.95, 0.24, 0.03), smoothstep(0.05, 0.45, t));
    c = mix(c, vec3(1.0, 0.62, 0.20), smoothstep(0.40, 0.85, t));
    c = mix(c, vec3(1.0, 0.90, 0.70), smoothstep(0.80, 1.35, t));
    c = mix(c, vec3(0.86, 0.92, 1.0), smoothstep(1.45, 2.3, t));
    return c;
  }

  // deflection still to come for a ray at distance r with direction cosine c
  // (c = -1 incoming, 1 outgoing): weak-field shape with the second-order
  // Schwarzschild term, alpha = 2/b + 15pi/16 / b^2 (rs = 1)
  float bendLeft(float b, float c) {
    float ib = 1.0 / b;
    float total = ib * (2.0 + ib * (2.9452 + ib * 5.3333));   // + third-order term
    return total * (2.0 - 3.0 * c + c * c * c) * 0.25;
  }

  /* ---------------- background sky ---------------- */
  // Stars are point sources: each one is drawn as a round dot in *screen*
  // space by pulling its sky offset back through the lensing Jacobian
  // (dx, dy = change of sky direction per pixel). Lensed images stay sharp
  // and get brighter where the hole magnifies them, instead of smearing.
  vec3 starLayer(vec3 d, vec3 dx, vec3 dy, float sc, float density, float seed, float mag) {
    vec3 p = d * sc;
    vec3 id = floor(p);
    vec3 h = hash33(id + seed);
    if (h.x > density) return vec3(0.0);
    vec3 sp = 0.2 + 0.6 * hash33(id * 1.37 + seed + 4.1);
    vec3 delta = normalize(id + sp) - d;
    float a = dot(dx, dx), b = dot(dx, dy), c = dot(dy, dy);
    float det = max(a * c - b * b, 1e-14);
    float r1 = dot(dx, delta), r2 = dot(dy, delta);
    float u = (c * r1 - b * r2) / det, v = (a * r2 - b * r1) / det;
    float dist2 = u * u + v * v;                       // in pixels^2
    float br = pow(h.y, 9.0) * 6.0 + 0.035;
    float s = exp(-dist2 * 2.2) * br * mag * uStarDim;
    vec3 tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.75, 0.84, 1.0), h.z);
    return tint * s;
  }
  vec3 sky(vec3 d, vec3 dx, vec3 dy) {
    float area = length(cross(dx, dy));
    float mag = clamp(pow(uPixAngle * uPixAngle / max(area, 1e-14), 0.5), 0.3, 3.0);
    vec3 c = starLayer(d, dx, dy, 60.0, 0.2, 0.0, mag);
    c += starLayer(d, dx, dy, 130.0, 0.14, 11.0, mag) * 0.6;
    c += starLayer(d, dx, dy, 240.0, 0.1, 23.0, mag) * 0.35;
    // faint galactic band: dust and a warm haze, kept very dark. Outside the
    // band its weight is below 1/255, so the noise is skipped there.
    float g = dot(d, uGalN);
    float band = exp(-g * g * 14.0);
    if (band > 0.004) {
      float n = noise3(d * 3.2) * 0.6 + noise3(d * 7.5) * 0.3 + noise3(d * 16.0) * 0.1;
      float dust = smoothstep(0.35, 0.85, noise3(d * 5.0 + 3.0));
      vec3 haze = mix(vec3(0.050, 0.038, 0.030), vec3(0.028, 0.032, 0.048), n) * band * (0.5 + 0.9 * n) * (1.0 - 0.75 * dust);
      c += haze;
      c += starLayer(d, dx, dy, 420.0, 0.5 * band, 37.0, mag) * 0.3 * band * (1.0 - dust);
    }
    return c * uStarGain;
  }

  /* ---------------- accretion disk ---------------- */
  float diskNoise(float r, float phi, float t) {
    // differential rotation: each ring turns at its Kepler rate; two phases
    // crossfade so the shear never winds up into noise
    float om = sqrt(0.5 / (r * r * r)) * 9.0;
    float T = 7.0;
    float ph0 = fract(t / T), ph1 = fract(t / T + 0.5);
    float w = abs(2.0 * ph0 - 1.0);
    float lr = log(r);
    float spiral = lr * 1.6;
    float a0 = phi - om * ph0 * T + spiral, a1 = phi - om * ph1 * T + spiral + 2.1;
    float P = 22.0;
    float n0 = pfbm(vec2(a0 / TAU * P, lr * 13.0), P);
    float n1 = pfbm(vec2(a1 / TAU * P, lr * 13.0 + 5.3), P);
    return mix(n0, n1, w);
  }

  // returns premultiplied rgb in .rgb, alpha in .a
  vec4 diskSample(vec3 hit, vec3 rayV) {
    float r = length(hit.xz);
    float phi = atan(hit.z, hit.x);
    float n = diskNoise(r, phi, uDiskTime);
    float fil = smoothstep(0.25, 0.85, n);
    float inner = smoothstep(RIN, RIN + 0.35, r);
    float outer = 1.0 - smoothstep(ROUT * 0.42, ROUT, r);
    float dens = inner * outer * (0.18 + 1.25 * fil * fil);

    // Novikov-Thorne-ish temperature profile
    float x = RIN / r;
    float temp = pow(x, 0.75) * pow(max(1.0 - sqrt(x) * 0.985, 0.0), 0.25) * 2.25;
    temp *= 0.82 + 0.36 * n;

    // relativistic beaming and gravitational redshift
    float beta = min(sqrt(0.5 / max(r - 1.0, 0.2)), 0.75);
    vec3 vel = beta * normalize(vec3(-hit.z, 0.0, hit.x));
    vec3 nPh = -normalize(rayV);
    float gam = inversesqrt(1.0 - beta * beta);
    float D = 1.0 / (gam * (1.0 - dot(vel, nPh)));
    float g = D * sqrt(max(1.0 - 1.0 / r, 0.0));
    float tObs = temp * g;
    float I = pow(g, 3.0) * pow(temp, 2.2) * uDiskGain;
    vec3 col = heat(tObs) * I * (0.55 + 1.2 * fil);
    // hot inner rim
    col += vec3(1.0, 0.85, 0.6) * exp(-(r - RIN) * 3.5) * inner * g * g * 0.8 * uDiskGain;
    float a = clamp(dens * 0.95, 0.0, 0.97);
    return vec4(col * a, a);
  }

  /* ---------------- bodies ---------------- */
  vec3 shadeBody(int k, vec3 hp, vec3 rd) {
    vec3 c = uBody[k].xyz;
    vec3 nrm = normalize(hp - c);
    vec4 col = uBodyCol[k];
    vec4 info = uBodyInfo[k];
    vec3 L = normalize(-hp + vec3(0.0, 0.6, 0.0));   // lit by the inner disk
    float diff = max(dot(nrm, L), 0.0);
    float wrap = max(dot(nrm, L) * 0.5 + 0.5, 0.0);
    vec3 ax = normalize(uBodyAxis[k].xyz + vec3(1e-4));
    float lat = dot(nrm, ax);
    float bands = noise3(vec3(lat * 9.0, info.z * 7.0, 0.0)) * 0.7 + noise3(nrm * 4.0 + info.z * 13.0) * 0.3;
    vec3 base = col.rgb * (0.55 + 0.75 * bands);
    // key light from the inner disk, plus the glow of the disk plane all around
    float near = exp(-abs(hp.y) * 0.25) * smoothstep(16.0, 6.0, length(hp.xz));
    vec3 diskAmb = vec3(1.0, 0.62, 0.32) * (0.05 + 0.1 * (1.0 - abs(nrm.y))) * (0.4 + near);
    vec3 lit = base * (diff * vec3(1.35, 1.02, 0.7) * 1.3 + wrap * 0.04 + diskAmb + 0.012);
    float fres = pow(1.0 - max(dot(nrm, -rd), 0.0), 3.0);
    lit += col.rgb * fres * (0.1 + 0.9 * diff) * 0.8;                    // thin atmosphere rim
    // back-lit by the disk: forward scattering lights the limb
    float back = max(dot(L, rd), 0.0);
    lit += vec3(1.0, 0.72, 0.42) * pow(fres, 1.6) * back * back * 1.6;
    // faint warm bounce from the disk plane below/above
    lit += base * vec3(0.9, 0.5, 0.2) * max(-nrm.y * sign(hp.y), 0.0) * 0.05;
    vec3 em = col.rgb * (1.4 + 1.2 * pow(max(dot(nrm, -rd), 0.0), 2.0)); // emissive star with limb darkening
    vec3 o = mix(lit, em * 1.15, col.a);
    o *= 1.0 + info.y * 1.2;
    o += vec3(1.0, 0.85, 0.6) * pow(fres, 2.0) * info.y * 0.6 * (1.0 - col.a);   // highlighted: lit limb
    return o;
  }

  // straight segment vs sphere: returns distance along seg (0..len) or -1
  float hitSphere(vec3 ro, vec3 rd, float len, vec4 s) {
    vec3 oc = ro - s.xyz;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - s.w * s.w;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    float t = -b - sqrt(disc);
    return (t >= 0.0 && t <= len) ? t : -1.0;
  }

  // glows and pulsar beams, along the initial (straight) ray
  vec3 halos(vec3 ro, vec3 rd, float tStop) {
    vec3 acc = vec3(0.0);
    for (int k = 0; k < ${MAX_BODIES}; k++) {
      if (k >= uBodyCount) break;
      vec4 info = uBodyInfo[k];
      if (info.w <= 0.0) continue;
      vec4 s = uBody[k];
      vec3 col = uBodyCol[k].rgb;
      vec3 oc = s.xyz - ro;
      float t = dot(oc, rd);
      if (t > 0.0 && t < tStop) {
        float d2 = max(dot(oc, oc) - t * t, 0.0);
        float R2 = s.w * s.w;
        acc += col * info.w * (R2 * 0.5 / (d2 + R2 * 0.5)) * 0.12 * (1.0 + info.y);
        acc += col * info.w * exp(-sqrt(d2) / (s.w * 3.5)) * 0.035 * (1.0 + info.y);
      }
      if (info.x > 1.5) {
        // pulsar: two opposed beams along the spin axis
        vec3 a = normalize(uBodyAxis[k].xyz);
        vec3 w0 = ro - s.xyz;
        float b = dot(rd, a), d = dot(rd, w0), e = dot(a, w0);
        float den = max(1.0 - b * b, 1e-3);
        float tc = (b * e - d) / den;
        float sc = (e - b * d) / den;
        if (tc > 0.0 && tc < tStop) {
          float dist = length(w0 + tc * rd - sc * a);
          float width = s.w * (0.22 + abs(sc) * 0.045);
          float beam = exp(-dist * dist / (width * width)) * exp(-abs(sc) * 0.22) * smoothstep(s.w, s.w * 2.5, abs(sc));
          acc += mix(col, vec3(1.0), 0.3) * beam * uBodyAxis[k].w * 0.45;
        }
        // lighthouse flash when a beam swings toward the camera
        float facing = abs(dot(a, normalize(-w0)));
        acc += col * pow(facing, 80.0) * uBodyAxis[k].w * 0.8 * exp(-length(cross(rd, -w0)) / (s.w * 4.0));
      }
    }
    return acc;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 rd = normalize(uCamFwd + uCamRight * (ndc.x - uShift.x) * uTanHalf * uAspect + uCamUp * (ndc.y - uShift.y) * uTanHalf);
    vec3 ro = uCamPos;

    vec3 hcr = cross(ro, rd);
    float h2 = dot(hcr, hcr);
    float b = sqrt(h2);                    // impact parameter
    float s0 = dot(ro, rd);                // < 0 while heading towards the hole

    vec3 col = vec3(0.0);
    float A = 0.0;                         // accumulated opacity
    bool captured = false;
    vec3 dirOut = rd;
    float tStop = 1e5;

    float far = ROUT + 4.0;
    // analytic weak-field direction for the whole ray (used beyond 'far', and
    // blended in over the last SEAM of impact parameter inside it, so the
    // hand-over from the march to the approximation leaves no seam)
    vec3 nh0 = (ro - s0 * rd) / max(b, 1e-4);
    vec3 dirWeak = normalize(rd - nh0 * tan(bendLeft(max(b, 1e-3), s0 / max(length(ro), 1e-4))));

    // geodesics stay in the plane through the hole that holds the ray, so a
    // body can only be hit if it lies within its radius of that plane
    vec3 pn0 = hcr / max(b, 1e-6);
    int mask = 0;
    for (int k = 0; k < ${MAX_BODIES}; k++) {
      if (k >= uBodyCount) break;
      if (b < 1e-3 || abs(dot(uBody[k].xyz, pn0)) < uBody[k].w) mask |= (1 << k);
    }

    if (b > far || (s0 > 0.0 && dot(ro, ro) > far * far)) {
      // ---- weak field: no disk possible, straight-ray bodies, analytic bending
      float best = 1e9; int hitK = -1;
      for (int k = 0; k < ${MAX_BODIES}; k++) {
        if (k >= uBodyCount) break;
        if ((mask & (1 << k)) == 0) continue;
        float t = hitSphere(ro, rd, 1e4, uBody[k]);
        if (t >= 0.0 && t < best) { best = t; hitK = k; }
      }
      if (hitK >= 0) {
        col = shadeBody(hitK, ro + rd * best, rd);
        A = 1.0; tStop = best;
      }
      dirOut = dirWeak;
    } else {
      // ---- strong field: march the geodesic
      vec3 p = ro;
      vec3 v = rd;
      // far camera: fly straight to the RSTART sphere (only bodies can be
      // there) and apply the small bend of that leg analytically
      if (dot(ro, ro) > RSTART * RSTART) {
        float tIn = -s0 - sqrt(max(s0 * s0 - dot(ro, ro) + RSTART * RSTART, 0.0));
        float best = 1e9; int hitK = -1;
        for (int k = 0; k < ${MAX_BODIES}; k++) {
          if (k >= uBodyCount) break;
          if ((mask & (1 << k)) == 0) continue;
          float t = hitSphere(ro, rd, tIn, uBody[k]);
          if (t >= 0.0 && t < best) { best = t; hitK = k; }
        }
        if (hitK >= 0) {
          col = shadeBody(hitK, ro + rd * best, rd);
          A = 1.0; tStop = best;
        }
        // turn position and direction together by the bend of the skipped
        // leg, which keeps the ray's impact parameter (and so its future) exact
        float sIn = s0 + tIn;
        float bendLeg = bendLeft(max(b, 1e-3), s0 / length(ro)) - bendLeft(max(b, 1e-3), sIn / RSTART);
        float cL = cos(bendLeg), sL = sin(bendLeg);
        v = cL * rd - sL * nh0;
        p = sIn * v + b * (sL * rd + cL * nh0);
      }
      float rEsc = RSTART;
      float r2 = dot(p, p);
      vec3 acc = -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
      for (int i = 0; i < 400; i++) {
        if (i >= uMaxSteps || A > 0.985) break;
        float r = sqrt(r2);
        if (r < 1.0) { captured = true; break; }
        float vr = dot(p, v);
        if (vr > 0.0 && r > rEsc - 0.01) break;
        // step size: fine near the hole, coarse far away. On the way out the
        // last step lands on the RSTART sphere, so the analytic tail always
        // starts at the same radius (a variable start drew faint rings).
        float ds = clamp(0.0225 * r * min(r, 6.0) * uStepScale, 0.02, 1.4);
        if (vr > 0.0) ds = min(ds, (rEsc - r) * r / vr + 0.002);
        vec3 vm = v + acc * ds * 0.5;
        vec3 pn = p + vm * ds;
        float rn2 = dot(pn, pn);
        vec3 accn = -1.5 * h2 * pn / (rn2 * rn2 * sqrt(rn2));
        vec3 vn = vm + accn * ds * 0.5;

        // disk plane crossing
        if (p.y * pn.y < 0.0) {
          float f = p.y / (p.y - pn.y);
          vec3 hit = mix(p, pn, f);
          float rr = length(hit.xz);
          if (rr > RIN * 0.98 && rr < ROUT) {
            vec4 d = diskSample(hit, mix(v, vn, f));
            col += (1.0 - A) * d.rgb;
            A += (1.0 - A) * d.a;
          }
        }
        // bodies (only the few near this ray's plane)
        if (mask != 0) {
          vec3 seg = pn - p;
          float len = length(seg);
          vec3 sd = seg / len;
          float best = 1e9; int hitK = -1;
          for (int k = 0; k < ${MAX_BODIES}; k++) {
            if (k >= uBodyCount) break;
            if ((mask & (1 << k)) == 0) continue;
            vec4 s = uBody[k];
            vec3 oc = p - s.xyz;
            float lim = len + s.w;
            if (dot(oc, oc) > lim * lim) continue;
            float t = hitSphere(p, sd, len, s);
            if (t >= 0.0 && t < best) { best = t; hitK = k; }
          }
          if (hitK >= 0) {
            col += (1.0 - A) * shadeBody(hitK, p + sd * best, sd);
            A = 1.0;
          }
        }
        p = pn; v = vn; r2 = rn2; acc = accn;
      }
      if (!captured) {
        // finish the remaining (small) bend analytically
        vec3 vv = normalize(v);
        vec3 hc = cross(p, vv);
        float bb = length(hc);
        float ss = dot(p, vv);
        vec3 nh = (p - ss * vv) / max(bb, 1e-4);
        float c = ss / max(length(p), 1e-4);
        dirOut = normalize(vv - nh * tan(bendLeft(max(bb, 1e-3), c)));
        dirOut = normalize(mix(dirOut, dirWeak, smoothstep(far - SEAM, far, b)));
        // bodies further out than the march went, along the outgoing ray
        if (mask != 0 && A < 0.985) {
          float best = 1e9; int hitK = -1;
          for (int k = 0; k < ${MAX_BODIES}; k++) {
            if (k >= uBodyCount) break;
            if ((mask & (1 << k)) == 0) continue;
            float t = hitSphere(p, dirOut, 1e4, uBody[k]);
            if (t >= 0.0 && t < best) { best = t; hitK = k; }
          }
          if (hitK >= 0) {
            col += (1.0 - A) * shadeBody(hitK, p + dirOut * best, dirOut);
            A = 1.0;
          }
        }
      }
      if (captured) tStop = max(length(ro) - 1.0, 0.0);
    }

    // background (derivatives taken in uniform control flow)
    vec3 ddx = dFdx(dirOut), ddy = dFdy(dirOut);
    if (!captured && A < 0.999) col += (1.0 - A) * sky(dirOut, ddx, ddy);

    // photon ring: the thin bright edge of the shadow, Doppler-weighted
    if (b > BCRIT) {
      float x = b - BCRIT;
      vec3 nh = normalize(ro - s0 * rd);
      vec3 tang = normalize(vec3(-nh.z, 0.0, nh.x) + vec3(1e-4));
      float dop = 1.0 + 0.55 * dot(tang, -rd);
      float ring = exp(-x * 26.0) * 1.2 + exp(-x * 5.5) * 0.12;
      col += (1.0 - A * 0.85) * vec3(1.0, 0.80, 0.52) * ring * dop * uRingGain;
    }

    col += halos(ro, rd, tStop) * (1.0 - A * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* bright pass + 4-tap downsample */
export const brightFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uThreshold;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - uThreshold, 0.0);
    k = k * k / (k + 0.6);
    c *= k / max(l, 1e-4);
    gl_FragColor = vec4(min(c, vec3(40.0)), 1.0);
  }
`;

export const downFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

/* 9-tap gaussian using 5 bilinear fetches */
export const blurFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
    c += texture2D(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
    c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/* final: bicubic upscale of the low-res hole, warp, bloom, tone map, grain */
export const compositeFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tHole, tBloom1, tBloom2;
  uniform vec2 uHoleRes;
  uniform vec2 uCenter;      // hole centre in uv
  uniform float uAspect;
  uniform float uWarp;       // photon-sphere crossing ripple
  uniform float uPull;       // scroll-speed radial smear
  uniform float uTime;
  uniform float uExposure;
  uniform float uBloom;
  uniform float uFade;
  uniform float uGrain;

  // Catmull-Rom bicubic in 9 bilinear taps
  vec3 bicubic(sampler2D tex, vec2 uv, vec2 res) {
    vec2 sp = uv * res;
    vec2 tp = floor(sp - 0.5) + 0.5;
    vec2 f = sp - tp;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 off12 = w2 / w12;
    vec2 t0 = (tp - 1.0) / res, t3 = (tp + 2.0) / res, t12 = (tp + off12) / res;
    vec3 c = vec3(0.0);
    c += texture2D(tex, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
    c += texture2D(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
    c += texture2D(tex, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
    c += texture2D(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
    c += texture2D(tex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
    c += texture2D(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
    c += texture2D(tex, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
    c += texture2D(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
    c += texture2D(tex, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
    return max(c, vec3(0.0));
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec2 d = uv - uCenter;
    vec2 da = vec2(d.x * uAspect, d.y);
    float len = length(da);

    // gravitational ripple when crossing the photon sphere
    if (uWarp > 0.001) {
      float ripple = sin(len * 26.0 - uTime * 7.0) * exp(-len * 2.2);
      float pull = uWarp * (0.10 * ripple - 0.16 * exp(-len * 3.0));
      uv = uCenter + d * (1.0 + pull);
    }

    vec3 col;
    if (uPull > 0.002) {
      // radial smear toward the hole while the camera falls in fast
      col = bicubic(tHole, uv, uHoleRes) * 0.4;
      for (int i = 1; i <= 4; i++) {
        float k = float(i) / 4.0;
        col += texture2D(tHole, uCenter + (uv - uCenter) * (1.0 - uPull * k * 0.06)).rgb * 0.15;
      }
    } else {
      col = bicubic(tHole, uv, uHoleRes);
    }
    // chromatic fringe during the crossing
    if (uWarp > 0.001) {
      vec2 off = (uv - uCenter) * 0.012 * uWarp;
      col.r = mix(col.r, texture2D(tHole, uv + off).r, 0.7);
      col.b = mix(col.b, texture2D(tHole, uv - off).b, 0.7);
    }

    col += (texture2D(tBloom1, uv).rgb * 0.55 + texture2D(tBloom2, uv).rgb * 0.75) * uBloom;
    col *= uExposure;
    col = aces(col);
    col = pow(col, vec3(1.0 / 2.2));

    // vignette
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55;
    // film grain + dither
    float g = hash(vUv * 1000.0 + fract(uTime * 7.13) * 100.0) - 0.5;
    col += g * uGrain;
    col *= uFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* orbit guides: thin instrument lines drawn on top, hidden behind the shadow */
export const lineVert = /* glsl */ `
  attribute float aT;
  uniform vec3 uCam;
  varying float vT;
  varying float vVis;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 seg = w.xyz - uCam;
    float L = length(seg);
    vec3 dir = seg / L;
    float s = clamp(dot(-uCam, dir), 0.0, L);
    float dc = length(uCam + dir * s);
    float behind = step(0.01, s) * step(s, L - 0.01);
    vVis = mix(1.0, smoothstep(2.7, 3.6, dc), behind) * smoothstep(0.6, 2.5, L);
    vT = aT;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
export const lineFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uDash;
  uniform float uTime;
  varying float vT;
  varying float vVis;
  void main() {
    float dash = uDash > 0.0 ? step(0.5, fract(vT * uDash - uTime * 0.05)) : 1.0;
    float a = uAlpha * vVis * mix(0.35, 1.0, dash);
    gl_FragColor = vec4(uColor, a);   // additive: src * alpha + dst
  }
`;
