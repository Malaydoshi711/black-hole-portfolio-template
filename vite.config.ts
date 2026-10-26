import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { education, experience, profile, publications, site, skills } from "./src/data/content.ts";

// Locally there is no LLM backend: answer POST /api/ask with 501 so the agent
// falls back to its built-in retrieval answers without logging a 404.
// On Vercel the real Edge Function in api/ask.ts handles this route.
function localAsk(): Plugin {
  const handler = (req: { method?: string; url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }, next: () => void) => {
    if (req.url?.split("?")[0] !== "/api/ask") return next();
    res.statusCode = req.method === "POST" ? 501 : 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "LLM not configured in local dev" }));
  };
  return {
    name: "local-api-ask",
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

// index.html head, sitemap.xml and robots.txt are all generated from
// `site` and `profile` in src/data/content.ts, so there is one place to edit.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = site.url.endsWith("/") ? site.url : `${site.url}/`;
const abs = (path: string) => new URL(path.replace(/^\//, ""), base).href;

function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(base)}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><priority>1.0</priority></url>
</urlset>
`;
}
const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${abs("sitemap.xml")}\n`;

function personLd() {
  const sameAs = site.socials.map((s) => s.href).filter((h) => /^https?:/.test(h));
  const award = publications.find((p) => p.award);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    url: base,
    jobTitle: profile.role,
    email: `mailto:${profile.email}`,
    address: { "@type": "PostalAddress", addressLocality: profile.city },
    knowsAbout: skills.map((s) => s.group),
  };
  if (experience[0]) ld.worksFor = { "@type": "Organization", name: experience[0].org };
  if (education[0]) ld.alumniOf = { "@type": "CollegeOrUniversity", name: education[0].school };
  if (award) ld.award = `${award.note ?? "Award"}, ${award.venue}`;
  if (sameAs.length) ld.sameAs = sameAs;
  return JSON.stringify(ld, null, 2).replace(/</g, "\\u003c");
}

function siteMeta(): Plugin {
  const serve = (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b?: string) => void }, next: () => void) => {
    const u = req.url?.split("?")[0];
    if (u === "/sitemap.xml") { res.setHeader("Content-Type", "application/xml"); return res.end(sitemap()); }
    if (u === "/robots.txt") { res.setHeader("Content-Type", "text/plain"); return res.end(robots()); }
    next();
  };
  return {
    name: "site-meta",
    configureServer(server) { server.middlewares.use(serve); },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap() });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots() });
    },
    transformIndexHtml(html) {
      const og = abs(site.ogImage);
      const meta = (attr: "name" | "property", key: string, content: string) => `<meta ${attr}="${key}" content="${esc(content)}" />`;
      const head = [
        `<title>${esc(site.title)}</title>`,
        meta("name", "description", site.description),
        meta("name", "author", profile.name),
        `<link rel="canonical" href="${esc(base)}" />`,
        meta("property", "og:type", "profile"),
        meta("property", "og:url", base),
        meta("property", "og:site_name", profile.name),
        meta("property", "og:locale", site.locale),
        meta("property", "og:title", site.title),
        meta("property", "og:description", site.description),
        meta("property", "og:image", og),
        meta("property", "og:image:width", "1200"),
        meta("property", "og:image:height", "630"),
        meta("property", "og:image:alt", site.ogAlt),
        meta("name", "twitter:card", "summary_large_image"),
        ...(site.twitter ? [meta("name", "twitter:site", site.twitter)] : []),
        meta("name", "twitter:title", site.title),
        meta("name", "twitter:description", site.description),
        meta("name", "twitter:image", og),
        `<script type="application/ld+json">\n${personLd()}\n</script>`,
      ].join("\n    ");
      return html
        .replace(/<html lang="[^"]*">/, `<html lang="${esc(site.lang)}">`)
        .replace(/<title>[\s\S]*?<\/title>/, head)
        .replace("<!--noscript-->", `${esc(profile.name)}, ${esc(profile.role)} in ${esc(profile.location)}. Email ${esc(profile.email)}.`);
    },
  };
}

export default defineConfig({
  plugins: [react(), localAsk(), siteMeta()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split the big libraries into their own cached files.
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return "three";
          if (/[\\/]node_modules[\\/](gsap|lenis)[\\/]/.test(id)) return "gsap";
        },
      },
    },
  },
});
