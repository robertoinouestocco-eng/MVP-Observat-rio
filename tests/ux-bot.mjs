#!/usr/bin/env node
/* Bot de UX do protótipo Kids Sentinel.
   Abre o index.html num Chromium de verdade e age como uma pessoa: navega, busca, filtra, preenche formulários,
   conversa com o assistente, usa só o teclado e repete tudo em celular iOS e Android.
   Cada verificação aponta o requisito do protótipo que está sendo testado. Relatório em ux-report/relatorio.md.
   Uso:  npm run ux-bot            (sobe o proxy sozinho, com IA simulada)
         npm run ux-bot -- --url http://localhost:3000        */
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(raiz, "ux-report");
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i < 0 ? "" : process.argv[i + 1]; };
const PERFIS = { desktop: { nome: "Computador", ctx: { viewport: { width: 1280, height: 800 } } }, "ios": { nome: "Celular iOS (iPhone 13)", ctx: devices["iPhone 13"] }, android: { nome: "Celular Android (Pixel 7)", ctx: devices["Pixel 7"] } };
const NOMES = ["Roblox", "Shein", "Shopee", "TikTok", "Instagram", "Discord", "YouTube", "Disney Plus", "X"];
const ROTAS = ["#/", "#/plataformas", "#/plataforma/roblox", "#/plataforma/discord", "#/ranking", "#/eca", "#/noticias", "#/relatorios", "#/observatorios", "#/radar", "#/radar?aba=plataforma"];
const DURO = ["criminos", "culpad", "vergonh", "negligent", "irresponsáve", "fraud", "descaso", "inaceitáve", "escândalo"];
const JURIDIQUES = ["outrossim", "destarte", "supracitad", "data venia", "ex vi", "consoante", "aduzir"];
const ok = (c, m) => { if (!c) throw new Error(m); };

let proxy = null, base = arg("url");
if (!base) {
  const porta = 3300 + Math.floor(Math.random() * 400); base = "http://localhost:" + porta;
  proxy = spawn(process.execPath, [path.join(raiz, "server", "proxy.mjs")], { env: { ...process.env, PORT: String(porta), KS_MOCK_AI: "1" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch (e) { /* aguarda */ } await new Promise((r) => setTimeout(r, 100)); }
}

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, "telas"), { recursive: true });
const RES = [], browser = await chromium.launch();

for (const [id, P] of Object.entries(PERFIS)) {
  const { defaultBrowserType, ...opts } = P.ctx;
  const ctx = await browser.newContext({ ...opts, locale: "pt-BR" }), page = await ctx.newPage(), logs = [];
  const fonte = (u) => /fonts\.(googleapis|gstatic)/.test(u || "");
  page.on("console", (m) => { if (m.type() === "error" && !fonte(m.location().url) && !/\/api\/chat/.test(m.location().url)) logs.push(m.text().slice(0, 150)); });
  page.on("pageerror", (e) => logs.push("script: " + e.message.slice(0, 150)));
  page.setDefaultTimeout(6000);
  const esperaRota = (h) => page.waitForSelector(`#view[data-rota="${h.slice(1) || "/"}"]`);
  const ir = async (h) => { await page.goto(base + "/" + h); await esperaRota(h || "#/"); };
  console.log("\n▶ " + P.nome);

  async function passo(req, nome, fn) {
    const antes = logs.length, r = { perfil: id, req, nome, status: "ok", detalhe: "" };
    try { const o = await fn(); if (o?.aviso) { r.status = "aviso"; r.detalhe = o.aviso; } if (logs.length > antes) { r.status = "falha"; r.detalhe = "Erro no console: " + logs[antes]; } }
    catch (e) { r.status = "falha"; r.detalhe = e.message.split("\n")[0].slice(0, 220); await page.screenshot({ path: path.join(OUT, "telas", `${id}-falha-${RES.length}.png`), fullPage: true }).catch(() => {}); }
    RES.push(r); console.log(`  ${r.status === "ok" ? "✔" : r.status === "aviso" ? "!" : "✖"} [${req}] ${nome}${r.detalhe ? " — " + r.detalhe : ""}`);
  }

  await passo("Geral", "O protótipo abre sem erros e o menu leva a cada página", async () => {
    await ir(""); ok((await page.title()).includes("Kids Sentinel"), "título da aba");
    for (const a of await page.locator("nav a").all()) { await a.click(); await esperaRota(await a.getAttribute("href")); ok(await a.getAttribute("aria-current") === "page", "menu não marca a página atual: " + (await a.innerText())); }
  });
  await passo("1 Relatórios", "Tabela de relatórios das plataformas com links oficiais", async () => {
    await ir("#/relatorios"); ok(await page.locator("table tr").count() >= 5, "poucos relatórios"); ok(await page.locator("table a[target=_blank][rel*=noopener]").count() >= 2, "faltam links oficiais");
  });
  await passo("2 Plataformas", "Uma página para cada uma das 9 plataformas", async () => {
    for (const n of NOMES) { await ir("#/plataformas"); await page.locator("#lista h3", { hasText: new RegExp("^" + n + "$") }).click(); await page.waitForSelector("#view[data-rota^='/plataforma/']"); ok(await page.locator("h1").innerText() === n, "não abriu " + n); }
  });
  await passo("3 Busca e filtros", "Buscar por nome, filtrar por categoria, aparelho e situação", async () => {
    await ir("#/plataformas"); ok(await page.locator("#lista .card").count() === 9, "deveria listar 9");
    await page.fill("#q", "tik"); ok(await page.locator("#lista .card").count() === 1, "busca por nome"); await page.fill("#q", "zzz"); ok(await page.locator("#lista .note").count() === 1, "sem mensagem de “nada encontrado”"); await page.fill("#q", "");
    await page.locator("#fc button", { hasText: "Streaming" }).click(); ok(await page.locator("#lista .card").count() === 2, "filtro de categoria");
    await page.locator("#fc button", { hasText: "Streaming" }).click(); await page.selectOption("#av", "s"); ok(await page.locator("#lista .card").count() === 2, "filtro “com análise”");
    await page.selectOption("#av", ""); await page.locator("#fo button", { hasText: "iOS" }).click(); ok(await page.locator("#lista .card").count() === 9, "filtro iOS");
  });
  await passo("4 Radar", "Denúncia: erros claros, envio e número de protocolo", async () => {
    await ir("#/radar?p=tiktok"); await page.click("#f button"); ok(await page.locator("#f [aria-invalid=true]").count() >= 2, "não apontou os campos com erro"); ok(await page.evaluate(() => document.activeElement.getAttribute("aria-invalid") === "true"), "foco não foi ao primeiro erro");
    await page.fill("#fd", "Teste do bot: o botão de denúncia estava difícil de achar."); await page.check("#fk"); await page.click("#f button"); await page.waitForSelector("#prot"); ok(/^KS-/.test(await page.locator("#prot").innerText()), "sem protocolo");
  });
  await passo("5.1 Plataformas podem contatar", "Formulário “Sou de uma plataforma” com validação e protocolo", async () => {
    await ir("#/plataforma/shein"); await page.locator("a", { hasText: "Sou da plataforma" }).click(); await page.waitForSelector("#view[data-rota^='/radar'] #fe"); ok(await page.locator("#fp").inputValue() === "shein", "plataforma não veio selecionada");
    await page.fill("#fe", "errado"); await page.fill("#fd", "Ativamos o perfil privado por padrão para menores de 16 anos."); await page.check("#fk"); await page.click("#f button"); ok(await page.locator("#fe[aria-invalid=true]").count() === 1, "e-mail inválido deveria ser recusado");
    await page.fill("#fe", "ana@empresa.com"); await page.click("#f button"); await page.waitForSelector("#prot");
  });
  await passo("6 Linguagem simples", "Sem termos duros, sem juridiquês, frases curtas", async () => {
    const achados = [];
    for (const h of ROTAS) { await ir(h); const t = (await page.locator("#view").innerText()).toLowerCase(); DURO.concat(JURIDIQUES).forEach((w) => t.includes(w) && achados.push(`${h}: “${w}”`)); const longas = (await page.locator("#view p, #view li, #view dd").allInnerTexts()).join(". ").toLowerCase().split(/[.!?]\s/).filter((s) => s.split(/\s+/).length > 45).length; if (longas > 1) achados.push(`${h}: ${longas} frases longas`); }
    ok(!achados.some((a) => /“/.test(a)), achados.join("; ")); return achados.length ? { aviso: achados.join("; ") } : null;
  });
  await passo("7 Prints", "Página da plataforma reserva espaço para prints com aparelho", async () => {
    await ir("#/plataforma/roblox"); const t = await page.locator("#view").innerText(); ok(/Evidências/.test(t) && await page.locator(".ph").count() >= 2, "sem área de prints"); ok(/iOS/.test(await page.locator(".ph").first().innerText()), "print sem aparelho");
  });
  await passo("8 Ranking", "Notas de 1 a 10, geral e por tema; plataformas sem análise explicadas", async () => {
    await ir("#/ranking"); const notas = (await page.locator("#rk .big").allInnerTexts()).map((x) => parseFloat(x.replace(",", "."))); ok(notas.length === 2 && notas.every((n) => n >= 1 && n <= 10), "notas fora de 1–10: " + notas);
    const g = notas.join(); await page.selectOption("#rt", "5"); ok((await page.locator("#rk .big").allInnerTexts()).join() !== g, "trocar o tema não mudou a nota"); ok(/Aguardando análise/.test(await page.locator("#sn").innerText()), "sem explicação para quem não tem nota");
    ok(await page.locator("#mx tr").count() === 15, "tabela por tema incompleta");
  });
  await passo("9 Atualização mensal", "Data e ciclo da atualização aparecem no início", async () => { await ir("#/"); ok(/Atualização mensal: \d\d\/\d\d\/\d{4}/.test(await page.locator("#view").innerText()), "sem data de atualização"); });
  await passo("10 Linha do tempo", "Lei e mudanças da plataforma, na ordem do tempo", async () => {
    await ir("#/plataforma/discord"); const n = await page.locator(".tl li").count(); ok(n >= 6, "poucos itens: " + n); ok(await page.locator(".tl li.lei").count() >= 3 && await page.locator(".tl li.plataforma").count() >= 1, "faltam itens de lei ou da plataforma");
    const ds = (await page.locator(".tl li .mut").allInnerTexts()).map((s) => s.split(" ·")[0].split("/").reverse().join("")); ok(ds.slice().sort().join() === ds.join(), "fora de ordem");
  });
  await passo("11 ECA traduzido", "14 temas em linguagem simples, busca, glossário e link para decisões", async () => {
    await ir("#/eca"); ok(await page.locator("#el details").count() === 14, "deveriam ser 14 temas"); await page.fill("#eq", "anúncios"); const n = await page.locator("#el details").count(); ok(n >= 1 && n < 14, "busca não filtrou");
    ok(await page.locator("dt").count() >= 8, "glossário curto"); await page.locator("a", { hasText: "Ver decisões" }).click(); await page.waitForSelector("#view[data-rota='/noticias'] #nl p"); ok(await page.locator("#nl p").count() >= 6, "poucas notícias");
    await page.locator("#nt button", { hasText: "Judiciário" }).click(); ok(await page.locator("#nl .note").count() === 1, "Judiciário vazio sem explicação");
  });
  await passo("12 Bot de IA", "Abrir, perguntar, receber resposta, Esc fecha e devolve o foco", async () => {
    await ir(""); await page.click("#fab"); ok(await page.evaluate(() => document.activeElement.id === "ci"), "foco não foi ao campo"); await page.fill("#ci", "O que é aferição de idade?"); await page.press("#ci", "Enter");
    await page.waitForFunction(() => [...document.querySelectorAll("#msgs .m.b")].some((m) => m.textContent.length > 20 && m.textContent !== "Pensando…")); await page.keyboard.press("Escape"); ok(await page.locator("#chat").isHidden() && await page.evaluate(() => document.activeElement.id === "fab"), "Esc/foco");
  });
  await passo("12 Bot de IA", "Sem o servidor de IA, o bot responde com a base local (modo offline)", async () => {
    await page.route("**/api/chat", (r) => r.abort()); await ir("#/eca"); await page.click("#fab"); await page.fill("#ci", "como funciona a verificação de idade?"); await page.press("#ci", "Enter");
    await page.waitForFunction(() => /Modo offline/.test(document.getElementById("msgs").innerText)); await page.unroute("**/api/chat");
  });
  await passo("13 iOS / Android", "Cada plataforma informa em quais aparelhos está (iOS, Android, Web)", async () => {
    for (const p of ["roblox", "x", "disneyplus"]) { await ir("#/plataforma/" + p); const o = await page.locator("h1 ~ .row .os").allInnerTexts(); ok(o.includes("iOS") && o.includes("Android"), p + " sem iOS/Android"); }
  });
  await passo("14 Outros observatórios", "Tabela comparando iniciativas, com o Kids Sentinel incluído", async () => { await ir("#/observatorios"); ok(await page.locator("table th").count() >= 7, "poucas colunas"); ok(/Kids Sentinel/.test(await page.locator("table").innerText()), "sem o Kids Sentinel"); });
  await passo("Acessibilidade", "Teclado (pular conteúdo, foco visível), um h1, rótulos e alt", async () => {
    await page.goto(base + "/?novo=" + Date.now()); await esperaRota("#/"); await page.keyboard.press("Tab"); ok(await page.evaluate(() => document.activeElement.className === "skip"), "primeiro Tab não é “Pular para o conteúdo”");
    const p = [];
    for (const h of ROTAS) { await ir(h); p.push(...(await page.evaluate((h) => { const o = []; if (document.querySelectorAll("h1").length !== 1) o.push(h + ": h1"); document.querySelectorAll("img:not([alt])").forEach(() => o.push(h + ": img sem alt")); document.querySelectorAll("input:not([type=hidden]),select,textarea").forEach((c) => { if (c.closest(".hp")) return; if (!(c.getAttribute("aria-label") || (c.id && document.querySelector(`label[for="${c.id}"]`)) || c.closest("label"))) o.push(h + ": campo sem rótulo #" + c.id); }); return o; }, h))); }
    ok(!p.length, p.slice(0, 5).join("; "));
  });
  await passo("Responsivo", "Nenhuma página rola na horizontal", async () => { for (const h of ROTAS) { await ir(h); ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), h + " rola na horizontal"); } });
  await passo("Geral", "Todos os links internos levam a uma página que existe", async () => {
    const hs = new Set(); for (const h of ROTAS) { await ir(h); (await page.locator("#view a[href^='#/']").evaluateAll((a) => a.map((x) => x.getAttribute("href")))).forEach((x) => hs.add(x)); }
    const q = []; for (const h of hs) { await ir(h); if (/não encontrada/i.test(await page.locator("h1").innerText())) q.push(h); } ok(!q.length, "quebrados: " + q.join(", "));
  });
  for (const h of ROTAS.slice(0, 5)) { await ir(h).catch(() => {}); await page.screenshot({ path: path.join(OUT, "telas", `${id}-${h.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: true }).catch(() => {}); }
  await ctx.close();
}
await browser.close(); proxy?.kill();

const n = (s) => RES.filter((r) => r.status === s).length;
const md = [`# Relatório do bot de UX — Kids Sentinel (protótipo)`, "", `Resultado: **${n("ok")} ok · ${n("aviso")} avisos · ${n("falha")} falhas** (${new Date().toLocaleString("pt-BR")})`, ""];
for (const [id, P] of Object.entries(PERFIS)) { md.push(`## ${P.nome}`, "", "| Requisito | Verificação | Resultado | Detalhe |", "|---|---|---|---|"); RES.filter((r) => r.perfil === id).forEach((r) => md.push(`| ${r.req} | ${r.nome} | ${r.status === "ok" ? "✔" : r.status === "aviso" ? "! aviso" : "✖ falha"} | ${(r.detalhe || "").replace(/\|/g, "/")} |`)); md.push(""); }
fs.writeFileSync(path.join(OUT, "relatorio.md"), md.join("\n")); fs.writeFileSync(path.join(OUT, "relatorio.json"), JSON.stringify(RES, null, 2));
console.log(`\nRelatório: ux-report/relatorio.md\n${n("ok")} ok · ${n("aviso")} avisos · ${n("falha")} falhas`); process.exit(n("falha") ? 1 : 0);
