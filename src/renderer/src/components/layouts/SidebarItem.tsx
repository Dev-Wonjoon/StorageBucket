import React from 'react';

interface SidebarItemProps {
    icon: React.ReactNode | null;
    label: string;
    isActive?: boolean;
    onClick: () => void;
}

export const SidebarItems = ({ icon, label, isActive, onClick }: SidebarItemProps) => {
    return (
        <button
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 px-4 py-3 mb-1 rounded-xl transition-all duration-200
                text-sm font-medium
                ${isActive 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }
            `}
    >
      <div className="w-5 h-5">{icon}</div>
      <span>{label}</span>
    </button>
    )
}