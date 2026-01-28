import { useMemo } from "react";
import { Media } from '../../../../shared/types';

const icons = {
    Info: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>,
    Folder: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>,
    Tag: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>,
    clock:() => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
    star: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>,
    Trash: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>,
}

interface PhotoCardProps {
    data: Media;
    isSelected: boolean;
    onClick: (id: number) => void;

    onInfo?: (id: number) => void;
    onOpenFolder?: (filepath: string) => void;
    onAddTag?: (id: number) => void;
    onDelete?: (id: number) => void;
}

export const PhotoCard = ({ data, isSelected, onClick }: PhotoCardProps) => {
    const hasThumbnail = Boolean(data.thumbnailPath);
    const imageUrl = useMemo(() => {
        if(!data.thumbnailPath) return null;
        const cleanPath = data.thumbnailPath.replace(/\\/g, '/');
        return `media://${cleanPath}`;
    }, [data.thumbnailPath]);

    const formatTime = (seconds: number) => {
        if(!seconds || seconds <= 0 || isNaN(seconds)) {
            return null;
        }
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    const disPlaytime = useMemo(() => formatTime(data.duration), [data.duration]);
    return (
        <div
            onClick={() => onClick(data.id)}
            className={`group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all duration-200
                        ${isSelected 
                        ? 'border-blue-500 ring-2 ring-blue-500/50 shadow-lg scale-95' 
                        : 'border-transparent hover:border-gray-500 hover:scale-[1.02]'
                    }   
        `}>
                {/* 썸네일 영역 */}
                <div className="aspect-video bg-gray-800 relative">
                    {hasThumbnail && imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={data.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center text-gray-500 bg-gray-800 w-full h-full">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-file-exclamation-point-icon lucide-file-exclamation-point"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                            <span className="text-[10px] mt-2 opacity-40 font-medium">No Preview</span>
                        </div>
                    )}
                    {/* 영상 길이 배지 */}
                    {disPlaytime && (
                        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                            {formatTime(data.duration)}
                        </div>
                    )}
                </div>

                {/* 정보 영역 */}
                <div className="bg-gray-900 p-2">
                    <h3 className="text-sm text-gray-100 truncate font-medium" title={data.title}>
                        {data.title}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1 truncate">
                        {new Date(data.createdAt).toLocaleDateString()}
                    </p>
                </div>
            {/* 선택 아이콘 표시 */}
            <div>
                
            </div>
        </div>
    );
};