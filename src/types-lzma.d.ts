declare module "lzma" {
  export function decompress(data: number[] | Uint8Array, cb: (result: number[] | string | null, error?: unknown) => void): void;
  export function compress(data: string | number[] | Uint8Array, mode: number, cb: (result: number[] | null, error?: unknown) => void): void;
}
