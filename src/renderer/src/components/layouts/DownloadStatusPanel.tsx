import { useState, useMemo } from 'react';

export interface DownloadItem {
    id: string;
    title: string;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
    speed?: string;
    eta?: string;
}

interface DownloadStatusPanelProps {
    items: DownloadItem[];
}

export const DownloadStatusPanel = ({ items }: DownloadStatusPanelProps) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const activeItems = useMemo(() => items.filter(i => i.status === 'downloading' || i.status === 'pending'), [items]);

    const totalProgress = useMemo(() => {
        if(activeItems.length === 0) return 0;
        return activeItems.reduce((acc, curr) => acc + curr.progress, 0) / activeItems.length;
    }, [activeItems]);

    if(items.length === 0) return null;
    if(activeItems.length === 0 && !isExpanded) return null;

    return (
        <div className='w-full max-w-4xl mx-auto mb-4 transition-all duration-300'>
            {/* 메인 상태 바 */}
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                className='bg-[--bg-sidebar] border border-[--border-line] rounded-xl p-4 cursor-pointer hover:border-[--color-primary] transition-colors shadow-sm relative overflow-hidden group'
            >

            </div>
        </div>
    )
}