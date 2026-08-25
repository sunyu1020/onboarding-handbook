// shadcn/ui 约定工具：合并 className（无外部依赖版本）
export function cn(...inputs: Array<string | undefined | null | false>) {
  return inputs.filter(Boolean).join(' ')
}
