export type Role = 'border' | 'text' | 'edge' | 'edgeLabel' | 'title' | 'none'

export type Span = { text: string; role: Role; classes?: string[]; href?: string }

export type Art = { plain: string[]; styled: Span[][]; width: number; warnings: string[] }

export function render(source: string): Art | null
