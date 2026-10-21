import { ALERT, ALERTS, type Block, type Inline, parseBlocks, parseInline, plainText, splitFrontMatter } from './markdown'

// 미리보기 문서를 브라우저 창 하나로 펼칠 HTML. 패널은 엔진이 터미널의 45%까지만 넓혀 주어서
// 창 전체로 보려면 바깥 창이 필요하다. 패널과 같은 파서를 써서 같은 문서 구조로 그린다.
// mermaid 만 CDN 스크립트로 그리고, 오프라인이면 코드 그대로 남는다.

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// javascript: 같은 주소는 링크로 걸지 않는다. 상대 경로는 <base> 로 문서 폴더에서 푼다.
const safeHref = (href: string) => (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto|file):/i.test(href) ? null : href)

// 패널 파서에는 그림 문법이 없어 ![설명](주소) 가 '!' 글자 + 링크로 온다. 브라우저에서는 그림으로 되살린다.
type Piece = Inline | { kind: 'image'; src: string; alt: string }

function images(nodes: Inline[]): Piece[] {
  return nodes.flatMap((node, index): Piece[] => {
    const next = nodes[index + 1]
    const previous = nodes[index - 1]
    if (node.kind === 'text' && node.text.endsWith('!') && next?.kind === 'link') return node.text.length > 1 ? [{ kind: 'text' as const, text: node.text.slice(0, -1) }] : []
    if (node.kind === 'link' && previous?.kind === 'text' && previous.text.endsWith('!')) return [{ kind: 'image' as const, src: node.href, alt: plainText(node.children) }]
    return [node]
  })
}

function inline(nodes: Inline[]): string {
  return images(nodes)
    .map(node => {
      switch (node.kind) {
        case 'image': {
          const src = safeHref(node.src)
          return src === null ? escape(node.alt) : `<img src="${escape(src)}" alt="${escape(node.alt)}">`
        }
        case 'text':
          return escape(node.text)
        case 'code':
          return `<code>${escape(node.text)}</code>`
        case 'bold':
          return `<strong>${inline(node.children)}</strong>`
        case 'italic':
          return `<em>${inline(node.children)}</em>`
        case 'strike':
          return `<del>${inline(node.children)}</del>`
        case 'link': {
          const href = safeHref(node.href)
          return href === null ? inline(node.children) : `<a href="${escape(href)}">${inline(node.children)}</a>`
        }
      }
    })
    .join('')
}

const prose = (text: string) => inline(parseInline(text))

const ALERT_CLASS: Record<string, string> = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'important', WARNING: 'warning', CAUTION: 'caution' }

function blocks(list: Block[]): string {
  return list
    .map(block => {
      switch (block.kind) {
        case 'heading': {
          const level = Math.min(6, Math.max(1, block.level))
          return `<h${level}>${prose(block.text)}</h${level}>`
        }
        case 'paragraph':
          return `<p>${prose(block.text)}</p>`
        case 'rule':
          return '<hr>'
        case 'code':
          if (block.language === 'mermaid') return `<pre class="mermaid">${escape(block.source)}</pre>`
          return `<pre><code${block.language ? ` data-lang="${escape(block.language)}"` : ''}>${escape(block.source)}</code></pre>`
        case 'table': {
          const count = Math.max(block.header.length, ...block.rows.map(row => row.length))
          const cells = (row: string[], tag: 'th' | 'td') =>
            Array.from({ length: count }, (_, index) => {
              const align = block.align[index]
              return `<${tag}${align && align !== 'left' ? ` style="text-align:${align}"` : ''}>${prose(row[index] ?? '')}</${tag}>`
            }).join('')
          return `<table><thead><tr>${cells(block.header, 'th')}</tr></thead><tbody>${block.rows.map(row => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>`
        }
        case 'quote': {
          const alert = ALERT.exec(block.raw)
          const kind = alert ? (alert[1] ?? '').toUpperCase() : ''
          const style = ALERTS[kind]
          if (alert && style) {
            return `<div class="alert ${ALERT_CLASS[kind]}"><p class="alert-title">${escape(style.title)}</p>${blocks(parseBlocks(block.raw.slice(alert[0].length)))}</div>`
          }
          return `<blockquote>${blocks(block.blocks)}</blockquote>`
        }
        case 'list':
          // 파서는 항목마다 깊이와 표시(번호·글머리)를 준다. 중첩 목록으로 다시 묶지 않고 그대로 들여 그린다.
          return `<div class="list">${block.items
            .map(item => `<div class="item" style="padding-left:${item.level * 1.5}em"><span class="marker">${escape(item.marker)}</span><span>${prose(item.text)}</span></div>`)
            .join('')}</div>`
      }
    })
    .join('\n')
}

const STYLE = `
:root{--bg:#fafaf8;--fg:#1f1f1e;--muted:#6b6a66;--border:#e3e1db;--code-bg:#f0eee8;--accent:#c96442;--link:#2f6fd6;
--note:#2f6fd6;--tip:#2e8a4e;--important:#c96442;--warning:#b7791f;--caution:#c53030}
@media (prefers-color-scheme:dark){:root{--bg:#1f1e1d;--fg:#ecebe6;--muted:#a09e97;--border:#3a3936;--code-bg:#2b2a28;--accent:#e08a66;--link:#7aa7f0;
--note:#7aa7f0;--tip:#6cc58b;--important:#e08a66;--warning:#e0b354;--caution:#f07a7a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Apple SD Gothic Neo",sans-serif}
main{max-width:1100px;margin:0 auto;padding:40px 32px 96px}
.path{color:var(--muted);font-size:13px;margin-bottom:24px;word-break:break-all}
h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.8em 0 .6em}
h1{color:var(--accent);font-size:1.9em}
h1,h2{padding-bottom:.3em;border-bottom:1px solid var(--border)}
main>h1:first-of-type{margin-top:0}
p{margin:.8em 0}
a{color:var(--link)}
code{font:.9em/1.5 ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;background:var(--code-bg);padding:.1em .35em;border-radius:4px}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:14px 16px;overflow-x:auto}
pre code{background:none;padding:0}
pre.mermaid{background:none;text-align:center}
table{border-collapse:collapse;margin:1em 0;display:block;overflow-x:auto}
th,td{border:1px solid var(--border);padding:6px 12px;text-align:left;vertical-align:top}
th{background:var(--code-bg)}
blockquote{margin:1em 0;padding:0 1em;border-left:3px solid var(--border);color:var(--muted)}
.alert{margin:1em 0;padding:.4em 1em;border:1px solid currentColor;border-radius:8px}
.alert>*:not(.alert-title){color:var(--fg)}
.alert-title{font-weight:600;margin:.4em 0}
.note{color:var(--note)}.tip{color:var(--tip)}.important{color:var(--important)}.warning{color:var(--warning)}.caution{color:var(--caution)}
.list{margin:.8em 0}
.item{display:flex;gap:.5em}
.marker{color:var(--muted);flex-shrink:0;min-width:1em}
img{max-width:100%}
hr{border:none;border-top:1px solid var(--border);margin:2em 0}
.front{display:grid;grid-template-columns:auto 1fr;gap:2px 16px;border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:24px;width:fit-content;font-size:14px}
.front dt{color:var(--muted)}.front dd{margin:0}
`

// path 는 실제 경로. 문서 안 상대 링크·그림이 문서 폴더에서 풀리게 <base> 를 단다.
export function previewHtml(markdown: string, path: string): string {
  const { fields, body } = splitFrontMatter(markdown)
  const folder = path.slice(0, path.lastIndexOf('/') + 1)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const front = fields.length > 0 ? `<dl class="front">${fields.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>` : ''
  const parsed = parseBlocks(body)
  const hasDiagram = parsed.some(block => block.kind === 'code' && block.language === 'mermaid')
  const mermaid = hasDiagram
    ? `<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true,theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"default"})</script>`
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${escape(encodeURI(`file://${folder}`).replace(/[#?]/g, encodeURIComponent))}">
<title>${escape(name)}</title><style>${STYLE}</style></head>
<body><main><div class="path">${escape(path)}</div>${front}
${blocks(parsed)}
</main>${mermaid}</body></html>
`
}
