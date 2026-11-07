# E Se... — shorts 3D em primeira pessoa

Canal **@esefossevoceai** (TikTok) — várias minisséries **"E Se..."** em 3D: vertical **1080×1920**, **30 fps**, **≥ 61 s**, câmera em **primeira pessoa** na altura dos olhos (**1,6 m**).

Série atual: **"E se um apocalipse zumbi começasse e você estivesse no Cristo Redentor?"** — cada episódio termina com uma escolha **A ou B**; a mais votada nos comentários decide o episódio seguinte (veja `series.json`).

## Stack (usada em todo vídeo)

| Etapa | Ferramenta | Arquivo |
|---|---|---|
| Mundo 3D | **Three.js** — a câmera é o espectador, a 1,6 m | `engine/core.js`, `engine/scenes/*.js` |
| Quadro a quadro | **Chrome headless (Playwright)** chama `renderFrame(t)` e tira um PNG | `engine/render.mjs` |
| Vídeo + som | **ffmpeg** junta os PNGs e mixa os efeitos sonoros | `engine/render.mjs`, `engine/sfx.mjs` |
| Roteiro | **`script.json`** por vídeo | `videos/<ep>/script.json` |

**Determinismo:** `renderFrame(t)` monta o quadro inteiro só a partir de `t` (sem relógio, sem `Math.random`, sem estado do quadro anterior). Renderizar o mesmo `t` duas vezes gera o mesmo PNG — por isso dá para usar várias páginas em paralelo.

Os sons são **sintetizados** por código (`engine/sfx.mjs`: vento, trilha, sirene, grunhido, grito, portão, coração, multidão, trem, impacto, whoosh, tensão, vibra) — nada para baixar, sem problema de direitos autorais.

## Uso

```bash
npm install
npm run test-render                                   # teste de 4 s -> out/teste-4s.mp4
node engine/render.mjs videos/ep01-cristo/script.json # episódio completo -> out/ep01-cristo.mp4
# opções: --start S --duration D --out arq.mp4 --workers N --stills 1,2,3 --keep
```

## Formato do `script.json`

```jsonc
{
  "scene": "cristo",                 // engine/scenes/cristo.js
  "fps": 30, "duration": 67,         // >= 61 s
  "title":   { "kicker": "E SE...", "text": "um *apocalipse zumbi*...", "short": "...", "duration": 3,
               "camera": { "to": { ... } } },
  "camera":  { "start": { "pos": [x, z], "yaw": 180, "pitch": -5, "fov": 72 } },
  "counter": { "label": "Infectados no Rio", "curve": "exp", "keys": [[t, valor], ...] },
  "captions": [                      // TODA legenda tem um movimento de câmera
    { "start": 3.0, "end": 6.6, "text": "Texto com *destaque amarelo*",
      "camera": { "to": { "pos": [x, z], "yaw": 166, "pitch": -17, "fov": 70 },
                  "ease": "inOut", "duration": 1.2, "shake": 0.2 } }
  ],
  "choice":  { "start": 61.5, "a": "...", "b": "...", "cta": "COMENTE A OU B" },
  "events":  [{ "t": 30, "id": "zumbis_escada" }],   // gatilhos da cena 3D
  "effects": [{ "t": 34.1, "type": "flash", "dur": 0.35 }],
  "sounds":  [{ "t": 10.4, "sfx": "sirene", "vol": 0.6, "dur": 4 }],
  "post":    { "titulo": "...", "descricao": "...", "comentario_fixado": "..." }
}
```

Câmera: `pos` em metros (`[x, z]` usa y = 1,6 m). `yaw` 0 = olhando para o Cristo; 180 = olhando para a cidade/baía; −90 = para a escadaria. `pitch` positivo olha para cima.

## Fluxo da série

1. Publicar o episódio com o texto de `post` e fixar o `comentario_fixado`.
2. Após 48 h, contar A × B e anotar em `series.json` (`votos`, `vencedora`).
3. Criar `videos/<próximo>/script.json` seguindo a opção vencedora e renderizar.
