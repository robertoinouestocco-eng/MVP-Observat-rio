# Kids Sentinel — protótipo de baixa fidelidade

Observatório do ECA Digital (Lei 15.211/2025). Protótipo para validar estrutura e fluxos; não é a versão final.

- `index.html` — o protótipo inteiro (abre direto no navegador). Dados em `<script id="dados">`.
- `server/proxy.mjs` — serve o HTML e conecta o assistente à API do Claude (chave só no servidor).
- `tests/ux-bot.mjs` — bot de UX (Playwright): testa os fluxos em computador, iOS e Android e gera `ux-report/relatorio.md`.

## Rodar
```bash
npm install
ANTHROPIC_API_KEY=sk-... npm start      # http://localhost:3000 (sem chave, o bot responde offline com a base local)
npm run ux-bot                          # sobe o proxy com IA simulada e testa tudo
```

## Requisitos → onde estão no protótipo
| # | Requisito | Onde |
|---|---|---|
| 1 | Relatórios | `#/relatorios` |
| 2 | Uma página por plataforma (9) | `#/plataforma/<id>` |
| 3 | Busca com filtros | `#/plataformas` (nome, categoria, aparelho, situação) e `#/eca` |
| 4 | Canal aberto (Radar) | `#/radar` |
| 5.1 | Plataformas podem contatar | `#/radar?aba=plataforma` e botão em cada plataforma |
| 6 | Linguagem simples | textos e rótulos (“conformidade”, “ponto de ajuste”, “sem informação”) |
| 7 | Prints dos erros | área “Evidências” (espaços reservados) |
| 8 | Ranking 1–10 por tema | `#/ranking` |
| 9 | Atualização mensal | dados em um JSON único; data/ciclo no início |
| 10 | Linha do tempo | na página de cada plataforma |
| 11 | ECA Digital traduzido + decisões | `#/eca`, `#/noticias` |
| 12 | Bot de IA (API do Claude) | botão “Tire sua dúvida”; `server/proxy.mjs` |
| 13 | iOS / Android | selos em cada plataforma e filtro de aparelho |
| 14 | Comparar observatórios | `#/observatorios` |

## Limitações do protótipo
- Radar e contato de plataformas só guardam no navegador (localStorage).
- Só Instagram (relatório da Meta) e Roblox têm análise; as demais aparecem “em avaliação”, sem nota.
- Prints são espaços reservados. Resumos de outros observatórios e a tradução do ECA precisam de revisão antes de publicar.
