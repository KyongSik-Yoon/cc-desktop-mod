// 엔진 환경에 있는 Uint8Array.toBase64(엔진 타입 문서의 Image 예제도 쓴다). TypeScript 5.9 lib(es2023)에는 아직 없다.
// 플러그인 계약(index.d.ts)은 전역을 보강할 수 없어(claude plugin validate) 타입 검사용으로 따로 둔다.
interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  toBase64(): string
}
