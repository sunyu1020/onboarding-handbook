// 全站左侧固定导航的目标屏映射（被 floating-nav.tsx 使用）
export interface NavItem {
  label: string;
  target: string; // 即 #screen-X 的 id
  icon: string; // SVG path 的 d 属性（viewBox 统一 0 0 24 24）
}

export const navItems: NavItem[] = [
  { label: "岗位拆解", target: "screen-3", icon: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M7 10l3 3 4-4 3 3" },
  { label: "工作台", target: "screen-2", icon: "M4 5h16v11H4z M8 19h8 M12 16v3" },
  { label: "会议纪要", target: "screen-5", icon: "M5 3h13v18H5z M4 7h2 M4 11h2 M4 15h2 M4 19h2" },
  { label: "周报", target: "screen-6", icon: "M7 2h10v20H7z M10 6h4 M10 10h4" },
  { label: "开挂室", target: "screen-7", icon: "M12 3l9 8h-3v10H6V11H3z M10 17v-6h4v6" },
];
