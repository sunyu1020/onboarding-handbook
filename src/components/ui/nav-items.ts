// 全站浮动导航的目标屏映射（被 hero.tsx / floating-nav.tsx 共用）
export interface NavItem {
  label: string;
  target: string; // 即 #screen-X 的 id
}

export const navItems: NavItem[] = [
  { label: "工作台", target: "screen-2" },
  { label: "岗位拆解", target: "screen-3" },
  { label: "台账", target: "screen-4" },
  { label: "会议纪要", target: "screen-5" },
  { label: "汇报", target: "screen-6" },
  { label: "开挂室", target: "screen-7" },
];
