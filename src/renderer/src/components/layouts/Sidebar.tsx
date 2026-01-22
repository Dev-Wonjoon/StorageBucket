

interface SidebarProps {
    activeMenu: string;
    onMenuClick: (id: string) => void;
}

export const Sidebar = ({ activeMenu, onMenuClick }: SidebarProps) => {
    const menus = [
        { id: 'search', label: '검색', icon: null },
        { id: 'gallery', label: '갤러리', icon: null},
        { id: 'favorites', label: '즐겨찾기', icon: null },
        { id: 'settings', label: '설정', icon: null },
    ];

    return (
        <aside className="w-full h-full bg-slate-900 border-r border-slate-800 flex flex-col">
            {/* 로고 */}


        </aside>
    )
}