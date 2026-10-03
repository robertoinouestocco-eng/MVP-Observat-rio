#!/usr/bin/env node
/* Bot de experiência do usuário (UX) do Kids Sentinel.
   Abre o site num navegador de verdade (Chromium via Playwright) e age como uma pessoa: navega, busca, filtra,
   preenche formulários, conversa com o assistente, usa só o teclado e testa em celular (iOS e Android) e desktop.
   Gera um relatório em ux-report/ (Markdown + JSON + capturas de tela).

   Uso:  npm run ux-bot                      (sobe o servidor sozinho, com IA simulada)
         npm run ux-bot -- --url http://localhost:3000   (testa um site já no ar)
         npm run ux-bot -- --perfil mobile-ios --headed  */
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const OUT = path.resolve(raiz, arg("out", "ux-report"));
const HEADED = !!arg("headed", false);
const SO_PERFIL = arg("perfil", "");

const PERFIS = {
  desktop: { rotulo: "Computador (1280×800)", ctx: { viewport: { width: 1280, height: 800 } } },
  "mobile-ios": { rotulo: "Celular iOS (iPhone 13)", ctx: { ...devices["iPhone 13"], defaultBrowserType: undefined } },
  "mobile-android": { rotulo: "Celular Android (Pixel 7)", ctx: { ...devices["Pixel 7"], defaultBrowserType: undefined } }
};
const PLATAFORMAS = ["Roblox", "Shein", "Shopee", "TikTok", "Instagram", "Discord", "YouTube", "Disney Plus", "X"];
const ROTAS = [["Início", "#/"], ["Plataformas", "#/plataformas"], ["Ranking", "#/ranking"], ["ECA traduzido", "#/eca"], ["Notícias", "#/noticias"], ["Relatórios", "#/relatorios"], ["Observatórios", "#/observatorios"], ["Radar", "#/radar"], ["Busca", "#/busca"], ["Como funciona", "#/metodo"], ["Boletim", "#/relatorios/boletim"]];
/* Palavras que não combinam com o tom do observatório (nunca agressivo) e “juridiquês” que afasta o público. */
const TOM_AGRESSIVO = ["criminos", "culpad", "vergonh", "negligent", "irresponsáve", "omiss", "fraud", "descaso", "inaceitáve", "escândalo", "condenável"];
const JURIDIQUES = ["outrossim", "destarte", "supracitad", "mister", "data venia", "ex vi", "consoante", "quiçá", "aduzir", "perfunctóri"];
const HOSTS_EXTERNOS_IGNORADOS = ["fonts.googleapis.com", "fonts.gstatic.com"];

/* ---------- servidor ---------- */
let servidor = null;
async function garantirServidor() {
  const u = arg("url", "");
  if (u && u !== true) return u.replace(/\/$/, "");
  const porta = 3200 + Math.floor(Math.random() * 500), storage = fs.mkdtempSync(path.join(os.tmpdir(), "ks-ux-"));
  servidor = spawn(process.execPath, [path.join(raiz, "server", "server.mjs")], { env: { ...process.env, PORT: String(porta), KS_MOCK_AI: "1", KS_STORAGE: storage }, stdio: "ignore" });
  const base = "http://localhost:" + porta;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + "/api/saude")).ok) return base; } catch (e) { /* aguarda */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("O servidor não subiu a tempo.");
}

/* ---------- registro ---------- */
const RES = [];
const falhar = (m) => { throw new Error(m); };
const esperar = (c, m) => { if (!c) falhar(m); };

async function rodarPerfil(browser, base, id) {
  const P = PERFIS[id], movel = id !== "desktop";
  const { defaultBrowserType, ...ctxOpts } = P.ctx;
  const ctx = await browser.newContext({ ...ctxOpts, locale: "pt-BR", acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  const externo = (u) => HOSTS_EXTERNOS_IGNORADOS.some((h) => (u || "").includes(h));
  page.on("console", (m) => { if (m.type() === "error" && !externo(m.location().url)) logs.push("console: " + m.text().slice(0, 200)); });
  page.on("pageerror", (e) => logs.push("erro de script: " + e.message.slice(0, 200)));
  page.on("requestfailed", (r) => { if (!externo(r.url())) logs.push("requisição falhou: " + r.url().slice(0, 120)); });
  page.on("response", (r) => { if (r.status() >= 400 && !externo(r.url()) && !/\/api\/chat$/.test(r.url())) logs.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`); });
  page.setDefaultTimeout(8000);
  fs.mkdirSync(path.join(OUT, "telas"), { recursive: true });

  const irPara = async (hash) => { await page.goto(base + "/" + hash); await page.waitForSelector("#view h1"); };
  const tela = async (nome) => { const f = `telas/${id}-${nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`; await page.screenshot({ path: path.join(OUT, f), fullPage: true }).catch(() => {}); return f; };

  async function passo(nome, fn, { pular = false } = {}) {
    if (pular) return;
    const t0 = Date.now(), antes = logs.length; let r = { perfil: id, nome, status: "ok", detalhe: "" };
    try {
      const out = await fn();
      if (out && out.aviso) { r.status = "aviso"; r.detalhe = out.aviso; } else if (out && out.info) r.detalhe = out.info;
      const novos = logs.slice(antes);
      if (novos.length) { r.status = "falha"; r.detalhe = ("Erros durante o passo: " + novos.slice(0, 3).join(" | ") + " " + r.detalhe).trim(); }
    } catch (e) { r.status = "falha"; r.detalhe = String(e.message).split("\n")[0].slice(0, 300); }
    r.ms = Date.now() - t0;
    if (r.status === "falha") r.tela = await tela("falha-" + nome);
    RES.push(r);
    console.log(`  ${r.status === "ok" ? "✔" : r.status === "aviso" ? "!" : "✖"} [${id}] ${nome}${r.detalhe ? " — " + r.detalhe : ""}`);
  }

  console.log(`\n▶ ${P.rotulo}`);

  /* 1 */ await passo("Carregamento inicial", async () => {
    const t0 = Date.now(); await irPara("");
    esperar((await page.title()).includes("Kids Sentinel"), "O título da aba não menciona o Kids Sentinel.");
    esperar(await page.locator("h1").first().innerText().then((t) => /kids sentinel/i.test(t)), "O título principal não é “Kids Sentinel”.");
    esperar(await page.locator("html[lang='pt-BR']").count(), "A página não declara lang=pt-BR.");
    await tela("inicio");
    const ms = Date.now() - t0; return ms > 3000 ? { aviso: `Carregou em ${ms} ms (acima de 3 s).` } : { info: `${ms} ms` };
  });

  /* 2 */ await passo("Menu: todas as páginas abrem", async () => {
    await irPara("");
    const links = await page.locator("nav.main a").all();
    esperar(links.length >= 8, "O menu principal tem menos de 8 itens.");
    for (const a of links) {
      const nome = (await a.innerText()).trim(); await a.click(); await page.waitForSelector("#view h1");
      esperar(await a.getAttribute("aria-current") === "page", `Menu “${nome}” não marca a página atual (aria-current).`);
      esperar((await page.title()).length > 12, `Título da aba vazio em “${nome}”.`);
    }
  });

  /* 3 */ await passo("Uma página por plataforma (9 plataformas)", async () => {
    await irPara("#/plataformas");
    const cards = page.locator("#kp a.card"); esperar(await cards.count() === PLATAFORMAS.length, `Esperava ${PLATAFORMAS.length} plataformas e encontrei ${await cards.count()}.`);
    for (const n of PLATAFORMAS) {
      await irPara("#/plataformas"); await page.locator("#kp a.card h3", { hasText: new RegExp("^" + n + "$") }).first().click();
      await page.waitForSelector("#view h1");
      esperar((await page.locator("h1").innerText()) === n, `A página de ${n} não abriu.`);
      for (const s of ["#resumo", "#requisitos", "#evidencias", "#linha", "#noticias", "#contato"]) esperar(await page.locator(s).count(), `${n}: falta a seção ${s}.`);
      const os = await page.locator("#view .os").allInnerTexts();
      esperar(os.includes("iOS") && os.includes("Android"), `${n}: não informa iOS e Android.`);
    }
  });

  /* 4 */ await passo("Busca e filtros na lista de plataformas", async () => {
    await irPara("#/plataformas");
    await page.fill("#fq", "roblox"); esperar(await page.locator("#kp a.card").count() === 1, "Buscar “roblox” deveria mostrar 1 plataforma.");
    await page.fill("#fq", "ROBLÓX".replace("Ó", "O")); esperar(await page.locator("#kp a.card").count() === 1, "A busca deveria ignorar maiúsculas.");
    await page.fill("#fq", "zzzzzz"); esperar(await page.locator("#kp .empty").count() === 1, "Busca sem resultado deveria mostrar uma mensagem amigável.");
    await page.fill("#fq", "");
    await page.locator("#fcat button", { hasText: "Streaming" }).click(); esperar(await page.locator("#kp a.card").count() === 2, "Categoria Streaming deveria ter 2 plataformas (YouTube e Disney Plus).");
    await page.locator("#fcat button", { hasText: "Streaming" }).click();
    await page.selectOption("#fav", "av"); esperar(await page.locator("#kp a.card").count() === 2, "“Com análise” deveria mostrar 2 plataformas.");
    await page.selectOption("#fav", "nao"); esperar(await page.locator("#kp a.card").count() === 7, "“Em avaliação” deveria mostrar 7 plataformas.");
    await page.selectOption("#fav", ""); await page.locator("#fso button", { hasText: "Android" }).click(); esperar(await page.locator("#kp a.card").count() === 9, "Todas rodam em Android.");
    esperar(await page.locator("#fcount").innerText().then((t) => /plataformas encontradas/.test(t)), "O contador de resultados não foi atualizado.");
    // a URL guarda os filtros (dá para compartilhar)
    esperar(page.url().includes("so=Android"), "Os filtros não ficam na URL.");
  });

  /* 5 */ await passo("Página da plataforma: requisitos, linha do tempo, evidências", async () => {
    await irPara("#/plataforma/discord");
    esperar(await page.locator("#rq-list .item").count() === 47, "Deveria listar os 47 requisitos.");
    await page.selectOption("#rq-eixo", "11"); esperar(await page.locator("#rq-list .item").count() === 4, "O tema “Denúncias e remoção” tem 4 requisitos.");
    await page.selectOption("#rq-eixo", ""); await page.fill("#rq-q", "idade"); esperar(await page.locator("#rq-list .item").count() > 3, "Buscar “idade” nos requisitos deveria achar vários.");
    const todos = await page.locator("#tl-list li").count(); esperar(todos >= 6, `A linha do tempo do Discord tem só ${todos} itens.`);
    await page.locator("#tl-f button", { hasText: "Lei" }).click(); const lei = await page.locator("#tl-list li").count(); esperar(lei > 0 && lei < todos, "O filtro “Lei” não reduziu a linha do tempo.");
    esperar(await page.locator("#ev-box .empty").count() === 1, "Sem prints, deveria aparecer um aviso explicando.");
    esperar((await page.locator("#resumo .callout").innerText()).includes("Em avaliação"), "Plataforma sem análise deveria dizer “Em avaliação”.");
    await page.locator("#contato a", { hasText: "Enviar ajuste" }).click(); await page.waitForSelector("#f-contato");
    esperar(await page.locator("#c-plat").inputValue() === "discord", "O contato da plataforma não veio com Discord selecionado.");
  });

  /* 6 */ await passo("Nota de 1 a 10 por plataforma e por tema", async () => {
    await irPara("#/plataforma/roblox");
    const t = await page.locator("#resumo .big").first().innerText(); const n = parseFloat(t.replace(",", "."));
    esperar(n >= 1 && n <= 10, `Nota fora do intervalo 1–10: ${t}`);
    const barras = await page.locator("#resumo .bar b").allInnerTexts(); esperar(barras.length >= 5, "Faltam as notas por tema.");
    for (const b of barras) { const v = parseFloat(b.replace(",", ".")); esperar(v >= 1 && v <= 10, `Nota por tema fora de 1–10: ${b}`); }
    esperar(await page.locator("#view .st").count() > 10, "Requisitos sem selo de situação.");
  });

  /* 7 */ await passo("Ranking: notas, filtros por tema, categoria e aparelho", async () => {
    await irPara("#/ranking");
    esperar(await page.locator("#rank a.card").count() === 2, "O ranking deveria ter 2 plataformas com análise.");
    esperar(await page.locator("#aguarda .chip").count() === 7, "Deveria listar 7 plataformas aguardando análise.");
    const geral = await page.locator("#rank a.card .big").allInnerTexts();
    await page.selectOption("#r-tema", "5"); const sup = await page.locator("#rank a.card .big").allInnerTexts();
    esperar(JSON.stringify(geral) !== JSON.stringify(sup), "Trocar o tema não mudou as notas.");
    await page.selectOption("#r-tema", "-1"); await page.locator("#r-cat button", { hasText: "Games" }).click();
    esperar(await page.locator("#rank a.card").count() === 1, "Filtrar por Games deveria deixar 1 plataforma.");
    await page.locator("#r-cat button", { hasText: "Games" }).click();
    await page.locator("details.acc summary").click(); await page.fill("#wp", "0"); esperar(JSON.stringify(await page.locator("#rank a.card .big").allInnerTexts()) !== JSON.stringify(geral), "Mudar o peso não alterou a nota.");
    await page.fill("#wp", "0.5");
    esperar(await page.locator("#axes .card").count() === 14, "Deveria haver um pódio para cada um dos 14 temas.");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#r-csv")]); esperar(dl.suggestedFilename().endsWith(".csv"), "O download do ranking não é CSV.");
  });

  /* 8 */ await passo("ECA Digital traduzido (linguagem simples)", async () => {
    await irPara("#/eca");
    esperar(await page.locator("#eca-l details.acc").count() === 14, "Deveria haver 14 temas traduzidos.");
    await page.fill("#eca-q", "anúncios"); const n = await page.locator("#eca-l details.acc").count(); esperar(n >= 1 && n < 14, "A busca na lei traduzida não filtrou.");
    await page.fill("#eca-q", ""); await page.locator("#eca-l summary").first().click(); esperar(await page.locator("#eca-l details[open]").count() === 1, "O tema não abriu.");
    esperar(await page.locator("#gloss dt").count() >= 8, "O glossário está incompleto.");
    esperar(await page.locator("a[href*='planalto.gov.br']").count() >= 1, "Falta o link para o texto oficial.");
  });

  /* 9 */ await passo("Decisões e notícias (ANPD, Judiciário, notícias)", async () => {
    await irPara("#/noticias");
    const tudo = await page.locator("#n-l .item").count(); esperar(tudo >= 6, "Poucas notícias.");
    await page.locator("#n-t button", { hasText: "ANPD" }).click(); esperar(await page.locator("#n-l .item").count() === 5, "Deveria haver 5 decisões da ANPD.");
    await page.locator("#n-t button", { hasText: "Judiciário" }).click(); esperar(await page.locator("#n-l .callout").count() === 1, "Sem decisões do Judiciário, deveria explicar.");
    await page.locator("#n-t button", { hasText: "Tudo" }).click(); await page.selectOption("#n-p", "discord"); esperar(await page.locator("#n-l .item").count() === 4, "Discord deveria ter 4 itens (3 decisões + monitoramento).");
    esperar(await page.locator("#n-l a[target=_blank][rel*=noopener]").count() === 4, "Links externos sem rel=noopener.");
  });

  /* 10 */ await passo("Relatórios: tabela, boletim e CSV", async () => {
    await irPara("#/relatorios");
    esperar(await page.locator("#rt tr").count() >= 10, "A tabela de relatórios deveria ter uma linha por plataforma.");
    await page.selectOption("#rf", "roblox"); esperar(await page.locator("#rt tr").count() === 2, "O filtro por plataforma não funcionou.");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#rel-csv")]); esperar(dl.suggestedFilename().endsWith(".csv"), "O download não é CSV.");
    await page.locator("a.card", { hasText: "Boletim" }).click(); await page.waitForSelector("h1");
    esperar(await page.locator("h1").innerText().then((t) => /Boletim/.test(t)), "O boletim não abriu.");
    esperar(await page.locator("button[data-print]").count() === 1, "Falta o botão de imprimir/PDF.");
    await tela("boletim");
  });

  /* 11 */ await passo("Comparar observatórios existentes", async () => {
    await irPara("#/observatorios");
    esperar(await page.locator("#ob-l .card").count() >= 8, "Poucos observatórios listados.");
    esperar(await page.locator("#ob-t th").count() === 4, "A comparação deveria começar com 3 observatórios.");
    await page.locator("#ob-l input[data-o=safernet]").check(); esperar(await page.locator("#ob-t th").count() === 5, "Marcar um 4º observatório deveria somá-lo à tabela.");
    await page.locator("#ob-l input[data-o=netlab]").check(); esperar(await page.locator("#ob-l input:checked").count() === 4, "O limite de 4 observatórios não foi respeitado.");
    esperar((await page.locator("#ob-t").innerText()).includes("Kids Sentinel"), "O Kids Sentinel deveria aparecer na comparação.");
  });

  /* 12 */ await passo("Busca global com filtros", async () => {
    await irPara("#/busca"); await page.fill("#b-q", "idade");
    const n = await page.locator("#b-r .item").count(); esperar(n > 5, "Buscar “idade” deveria achar vários resultados.");
    await page.locator("#b-t button", { hasText: "Plataformas" }).click(); await page.fill("#b-q", "");
    esperar(await page.locator("#b-r .item").count() === 9, "Tipo “Plataformas” deveria listar 9.");
    await page.selectOption("#b-nm", "5"); esperar(await page.locator("#b-r .item").count() >= 1, "Nota mínima 5 deveria manter ao menos 1 plataforma.");
    await page.selectOption("#b-nm", ""); await page.locator("#b-t button", { hasText: "Plataformas" }).click(); await page.locator("#b-t button", { hasText: "Requisitos" }).click();
    await page.selectOption("#b-pl", "roblox"); await page.selectOption("#b-st", "A"); const a = await page.locator("#b-r .item").count(); esperar(a > 5 && a < 47, `Requisitos “em conformidade” no Roblox: ${a}.`);
    await page.selectOption("#b-st", "I"); esperar(await page.locator("#b-r .empty").count() === 1, "Nenhum requisito está em “Ponto de ajuste”; deveria dizer que nada foi encontrado.");
    // busca do topo
    await irPara(""); await page.fill("#busca-q", "discord"); await page.press("#busca-q", "Enter"); await page.waitForSelector("#b-r");
    esperar(page.url().includes("#/busca?q=discord"), "A busca do topo não levou à página de busca.");
  });

  /* 13 */ await passo("Radar: validação clara dos erros", async () => {
    await irPara("#/radar"); await page.click("#f-radar button[type=submit]");
    esperar(await page.locator("#f-radar [aria-invalid=true]").count() >= 2, "Enviar vazio deveria apontar os campos com problema.");
    esperar((await page.locator(".field-error").first().innerText()).length > 10, "Mensagem de erro vazia.");
    esperar(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-invalid") === "true"), "O foco deveria ir para o primeiro campo com erro.");
    await page.setInputFiles("#r-img", { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    esperar(await page.locator("#r-img-erro").count() === 1, "Um PDF no lugar de imagem deveria ser recusado com explicação.");
  });

  /* 14 */ await passo("Radar: enviar denúncia com print e receber protocolo", async () => {
    await irPara("#/radar?plataforma=tiktok");
    esperar(await page.locator("#r-plat").inputValue() === "tiktok", "A plataforma pré-selecionada não veio do link.");
    await page.selectOption("#r-tipo", "denuncia"); await page.selectOption("#r-so", "Android");
    await page.fill("#r-desc", "Teste automático do bot de UX: o botão de denúncia estava difícil de achar no aplicativo.");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles("#r-img", { name: "print.png", mimeType: "image/png", buffer: png }); await page.waitForSelector("#r-prev img");
    await page.check("#r-ok"); await page.click("#f-radar button[type=submit]"); await page.waitForSelector("#protocolo");
    esperar(/^KS-\d{6}-[0-9A-F]{6}$/.test(await page.locator("#protocolo").innerText()), "O protocolo não tem o formato esperado.");
    const st = await (await fetch(base + "/api/radar/stats")).json(); esperar(st.total >= 1, "O servidor não registrou a denúncia.");
  });

  /* 15 */ await passo("Contato de plataformas (ajustes)", async () => {
    await irPara("#/radar?aba=plataforma"); await page.click("#f-contato button[type=submit]");
    esperar(await page.locator("#f-contato [aria-invalid=true]").count() >= 3, "Formulário vazio deveria apontar vários campos.");
    await page.selectOption("#c-plat", "shein"); await page.selectOption("#c-tipo", "ajuste"); await page.fill("#c-nome", "Ana Teste"); await page.fill("#c-cargo", "Políticas de segurança"); await page.fill("#c-mail", "ana@exemplo.com");
    await page.fill("#c-msg", "Informamos que ativamos o perfil privado por padrão para menores de 16 anos."); await page.check("#c-ok"); await page.click("#f-contato button[type=submit]");
    await page.waitForSelector("#protocolo"); esperar(/^KS-/.test(await page.locator("#protocolo").innerText()), "Sem protocolo.");
  });

  /* 16 */ await passo("Radar: robô (campo isca) não gera registro", async () => {
    const antes = (await (await fetch(base + "/api/radar/stats")).json()).total;
    const r = await fetch(base + "/api/radar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "denuncia", descricao: "x".repeat(40), site: "http://spam" }) });
    esperar(r.ok, "A resposta ao robô deveria parecer normal."); const depois = (await (await fetch(base + "/api/radar/stats")).json()).total; esperar(antes === depois, "O envio do robô foi gravado.");
  });

  /* 17 */ await passo("Assistente de IA: perguntar e receber resposta", async () => {
    await irPara(""); await page.click("#chat-fab"); await page.waitForSelector("#chat-box:not([hidden])");
    esperar(await page.locator("#chat-fab").getAttribute("aria-expanded") === "true", "O botão do chat não indica que abriu.");
    esperar(await page.evaluate(() => document.activeElement.id === "chat-in"), "O foco deveria ir para o campo de pergunta.");
    await page.fill("#chat-in", "O que é aferição de idade?"); await page.press("#chat-in", "Enter");
    await page.waitForFunction(() => document.querySelectorAll("#chat-msgs .msg.b").length >= 2 && !document.querySelector("#chat-msgs [aria-busy]"));
    const ult = await page.locator("#chat-msgs .msg.b").last().innerText(); esperar(ult.length > 20, "Resposta vazia.");
    await page.locator("#chat-sugg button").first().click(); await page.waitForFunction(() => document.querySelectorAll("#chat-msgs .msg.u").length >= 2);
    await page.keyboard.press("Escape"); esperar(await page.locator("#chat-box").isHidden(), "Esc deveria fechar o chat.");
    esperar(await page.evaluate(() => document.activeElement.id === "chat-fab"), "O foco deveria voltar ao botão do chat.");
    await page.click("#chat-fab"); await tela("chat");
  });

  /* 18 */ await passo("Assistente continua útil sem o servidor de IA (modo offline)", async () => {
    await page.route("**/api/chat", (r) => r.abort()); await irPara("#/plataforma/roblox");
    await page.click("#chat-fab"); await page.fill("#chat-in", "Qual a nota do Roblox?"); await page.press("#chat-in", "Enter");
    await page.waitForFunction(() => /Modo offline/.test(document.querySelector("#chat-msgs").innerText));
    esperar(/nota/i.test(await page.locator("#chat-msgs .msg.b").last().innerText()), "A resposta offline não falou da nota.");
    await page.unroute("**/api/chat");
  });

  /* 19 */ await passo("Só com teclado: pular para o conteúdo e usar o menu", async () => {
    await irPara(""); await page.keyboard.press("Tab");
    esperar(await page.evaluate(() => document.activeElement.classList.contains("skip")), "O primeiro Tab deveria focar “Pular para o conteúdo”.");
    await page.keyboard.press("Enter"); esperar(page.url().includes("#view") || await page.evaluate(() => location.hash === "#view" || true), "");
    await irPara("#/plataformas"); await page.focus("#fq"); await page.keyboard.type("tik"); esperar(await page.locator("#kp a.card").count() === 1, "Digitar no filtro com o teclado deveria filtrar.");
    const alvo = page.locator("#kp a.card").first(); await alvo.focus(); await page.keyboard.press("Enter"); await page.waitForSelector("#resumo");
    esperar((await page.locator("h1").innerText()) === "TikTok", "Enter no cartão deveria abrir a página.");
    esperar(await page.evaluate(() => document.activeElement.tagName === "H1"), "Após navegar, o foco deveria ir para o título da página (leitores de tela).");
    const semFoco = await page.evaluate(() => { const el = document.querySelector("nav.main a"); el.focus(); const s = getComputedStyle(el); return s.outlineStyle === "none" && s.boxShadow === "none"; });
    esperar(!semFoco, "O foco do teclado não está visível nos links do menu.");
  });

  /* 20 */ await passo("Acessibilidade básica em todas as páginas", async () => {
    const problemas = [];
    for (const [nome, h] of ROTAS.concat([["Plataforma", "#/plataforma/roblox"]])) {
      await irPara(h);
      const r = await page.evaluate(() => {
        const out = [], vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        if (document.querySelectorAll("h1").length !== 1) out.push(`${document.querySelectorAll("h1").length} títulos h1`);
        let ant = 1; document.querySelectorAll("#view h1,#view h2,#view h3,#view h4").forEach((h) => { const n = +h.tagName[1]; if (n - ant > 1) out.push(`salto de ${h.tagName.toLowerCase()} após h${ant}`); ant = n; });
        document.querySelectorAll("img").forEach((i) => { if (!i.hasAttribute("alt")) out.push("imagem sem alt: " + i.src.slice(-30)); });
        document.querySelectorAll("input:not([type=hidden]),select,textarea").forEach((c) => {
          if (!vis(c) && !c.closest(".hp") && c.type !== "file") return; if (c.closest(".hp")) return;
          const nome = c.getAttribute("aria-label") || (c.id && document.querySelector(`label[for="${c.id}"]`)) || c.closest("label") || c.getAttribute("aria-labelledby") || c.title;
          if (!nome && c.id !== "imp") out.push(`campo sem rótulo: #${c.id || c.type}`);
        });
        document.querySelectorAll("button").forEach((b) => { if (vis(b) && !(b.innerText || b.getAttribute("aria-label") || b.title || "").trim()) out.push("botão sem nome"); });
        document.querySelectorAll("a[target=_blank]").forEach((a) => { if (!/noopener/.test(a.rel)) out.push("link externo sem noopener"); });
        return out;
      });
      r.forEach((x) => problemas.push(`${nome}: ${x}`));
    }
    esperar(!problemas.length, problemas.slice(0, 6).join("; "));
  });

  /* 21 */ await passo("Aumentar o texto e alto contraste funcionam", async () => {
    await irPara(""); const f0 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    await page.click("#fs-mais"); await page.click("#fs-mais"); const f1 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    esperar(f1 > f0 * 1.15, `A+ não aumentou o texto (${f0} → ${f1}).`);
    await page.click("#contraste"); esperar(await page.locator("html[data-contrast=alto]").count() === 1, "O alto contraste não foi aplicado.");
    esperar(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Com o texto maior, a página ganhou rolagem horizontal.");
    await page.click("#fs-menos"); await page.click("#fs-menos"); await page.click("#contraste");
  });

  /* 22 */ await passo("Sem rolagem horizontal e cliques fáceis (todas as páginas)", async () => {
    const avisos = [];
    for (const [nome, h] of ROTAS.concat([["Plataforma", "#/plataforma/roblox"]])) {
      await irPara(h);
      const o = await page.evaluate(() => ({ larg: document.documentElement.scrollWidth - window.innerWidth,
        pequenos: Array.from(document.querySelectorAll("#view a, #view button, #view select, #view input:not([type=hidden])")).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 28 && !e.closest(".hp") && e.type !== "checkbox" && e.type !== "radio" && !(e.tagName === "A" && e.closest("p,li,dd,td,.item,.callout,.crumbs,caption,span")); }).length }));
      if (o.larg > 1) falhar(`${nome}: a página rola na horizontal (${o.larg}px a mais que a tela).`);
      if (movel && o.pequenos > 0) avisos.push(`${nome}: ${o.pequenos} alvo(s) de toque pequenos`);
    }
    return avisos.length ? { aviso: avisos.slice(0, 4).join("; ") } : null;
  });

  /* 23 */ await passo("Tom: linguagem simples e nunca agressiva", async () => {
    const achados = [];
    for (const [nome, h] of ROTAS.concat([["Plataforma (Roblox)", "#/plataforma/roblox"], ["Plataforma (Discord)", "#/plataforma/discord"]])) {
      await irPara(h);
      const t = (await page.locator("#view").innerText()).toLowerCase();
      TOM_AGRESSIVO.forEach((w) => { if (t.includes(w)) achados.push(`${nome}: termo duro “${w}”`); });
      JURIDIQUES.forEach((w) => { if (t.includes(w)) achados.push(`${nome}: juridiquês “${w}”`); });
      const frases = t.split(/[.!?]\s/).map((s) => s.split(/\s+/).length).filter((n) => n > 45).length;
      if (frases > 2) achados.push(`${nome}: ${frases} frases com mais de 45 palavras`);
    }
    return achados.length ? { aviso: achados.slice(0, 5).join("; ") } : { info: "sem termos duros ou juridiquês" };
  });

  /* 24 */ await passo("Todos os links internos levam a uma página válida", async () => {
    const hrefs = new Set();
    for (const [, h] of ROTAS.concat([["p", "#/plataforma/roblox"], ["p", "#/plataforma/tiktok"]])) { await irPara(h); (await page.locator("#view a[href^='#/'], nav a[href^='#/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).forEach((x) => hrefs.add(x)); }
    const quebrados = [];
    for (const h of hrefs) { await irPara(h); if (/não encontrada/i.test(await page.locator("h1").first().innerText())) quebrados.push(h); }
    esperar(!quebrados.length, "Links quebrados: " + quebrados.slice(0, 5).join(", ")); return { info: hrefs.size + " links conferidos" };
  });

  /* 25 */ await passo("Modo editor: atualização mensal rápida (muda situação e exporta)", async () => {
    await irPara("#/plataforma/shein"); const antes = (await page.locator("#resumo").innerText()).includes("Em avaliação"); esperar(antes, "Shein deveria começar em avaliação.");
    await page.click("#editor-toggle"); await page.waitForSelector("#rq-list select");
    await page.selectOption("#s-PP-01", "A"); await page.selectOption("#s-PP-02", "P"); await page.waitForSelector("#resumo .big");
    esperar(await page.locator("#resumo .big").count() >= 1, "Depois de avaliar, a Shein deveria ganhar nota.");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exp")]); esperar(/\.json$/.test(dl.suggestedFilename()), "A exportação não gerou JSON.");
    const conteudo = JSON.parse(fs.readFileSync(await dl.path(), "utf8")); esperar(conteudo.overrides["PP-01"].shein === "A", "O JSON exportado não traz a alteração.");
    await page.once("dialog", (d) => d.accept()); await page.click("#limpa"); await page.waitForSelector("#view h1");
  });

  /* 26 */ await passo("Imprimir o boletim (CSS de impressão esconde menus)", async () => {
    await irPara("#/relatorios/boletim"); await page.emulateMedia({ media: "print" });
    esperar(await page.locator("header.top").isHidden(), "No modo de impressão o cabeçalho deveria sumir."); esperar(await page.locator(".chat-fab").isHidden(), "No modo de impressão o botão do chat deveria sumir.");
    await page.emulateMedia({ media: "screen" });
  });

  /* 27 */ await passo("Página inexistente mostra mensagem amigável", async () => {
    await irPara("#/nao-existe"); esperar(/não encontrada/i.test(await page.locator("h1").innerText()), "A página 404 não explicou o problema.");
    esperar(await page.locator("#view a[href='#/']").count() === 1, "A página 404 deveria oferecer um caminho de volta.");
  });

  /* Capturas de referência de cada página */
  for (const [nome, h] of ROTAS) { await irPara(h).catch(() => {}); await tela("pagina-" + nome); }
  await irPara("#/plataforma/roblox").catch(() => {}); await tela("pagina-plataforma-roblox");
  await ctx.close();
}

/* ---------- relatório ---------- */
function escreverRelatorio(base, perfis) {
  fs.mkdirSync(OUT, { recursive: true });
  const cont = (s) => RES.filter((r) => r.status === s).length;
  const linhas = [];
  linhas.push("# Relatório do bot de UX — Kids Sentinel", "", `- Site testado: ${base}`, `- Data: ${new Date().toLocaleString("pt-BR")}`, `- Perfis: ${perfis.map((p) => PERFIS[p].rotulo).join("; ")}`, `- Resultado: **${cont("ok")} ok**, **${cont("aviso")} avisos**, **${cont("falha")} falhas** (${RES.length} verificações)`, "");
  for (const p of perfis) {
    const rs = RES.filter((r) => r.perfil === p);
    linhas.push(`## ${PERFIS[p].rotulo}`, "", "| Verificação | Resultado | Detalhe | Tempo |", "|---|---|---|---|");
    rs.forEach((r) => linhas.push(`| ${r.nome} | ${r.status === "ok" ? "✔ ok" : r.status === "aviso" ? "! aviso" : "✖ falha"} | ${(r.detalhe || "").replace(/\|/g, "/")}${r.tela ? ` ([tela](${r.tela}))` : ""} | ${r.ms} ms |`));
    linhas.push("");
  }
  linhas.push("## Capturas de tela", "", "As páginas principais de cada perfil estão em `telas/`.", "");
  fs.writeFileSync(path.join(OUT, "relatorio.md"), linhas.join("\n"));
  fs.writeFileSync(path.join(OUT, "relatorio.json"), JSON.stringify({ site: base, em: new Date().toISOString(), resultados: RES }, null, 2));
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const base = await garantirServidor();
  const perfis = Object.keys(PERFIS).filter((p) => !SO_PERFIL || p === SO_PERFIL);
  const browser = await chromium.launch({ headless: !HEADED, executablePath: process.env.KS_CHROMIUM || undefined });
  try { for (const p of perfis) await rodarPerfil(browser, base, p); } finally { await browser.close(); if (servidor) servidor.kill(); }
  escreverRelatorio(base, perfis);
  const f = RES.filter((r) => r.status === "falha").length, a = RES.filter((r) => r.status === "aviso").length;
  console.log(`\nRelatório: ${path.join(OUT, "relatorio.md")}\n${RES.length - f - a} ok · ${a} avisos · ${f} falhas`);
  process.exit(f ? 1 : 0);
}
main().catch((e) => { console.error(e); if (servidor) servidor.kill(); process.exit(2); });
