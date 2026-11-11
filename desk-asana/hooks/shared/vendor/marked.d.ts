// marked 18.2.0 의 Lexer 중 desk-look 이 쓰는 것만 적는다. 토큰 필드는 종류마다 달라 느슨하게 둔다.
export type Token = { type: string; raw: string; text?: string; [key: string]: any }
export class Lexer {
  constructor(options?: { gfm?: boolean; breaks?: boolean })
  lex(src: string): Token[]
  // 블록 토큰만(인라인 토큰을 만들지 않는다)
  blockTokens(src: string): Token[]
}
