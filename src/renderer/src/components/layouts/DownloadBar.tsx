import { useState } from "react";

interface DownloadBarProps {
    onStartDownload?: (url: string) => void;
}

export const DownloadBar = ({ onStartDownload }: DownloadBarProps) => {
    const [ url, setUrl ] = useState('');
    const [isChecking, setIsChecking] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!url.trim()) return

        setIsChecking(true);
        if(onStartDownload) {
            onStartDownload(url);
        }

        setTimeout(() => {
            setIsChecking(false);
            setUrl('');
        }, 1000);
    }

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto flex gap-3">
            <div className="relative flex-1 group">
                <div>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[--text-muted] group-focus-within:text-[--color-primary] transition-colors">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                    </svg>
                </div>
                {/*TODO: placeholder 테마 전환시 색깔 변경 */}
                <input 
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="다운로드할 링크를 붙여넣으세요..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border transition-all shadow-sm outline-none
                            bg-[--bg-sidebar] border-[--border-line] text-[--text-main] 
                            placeholder:text-[--text-muted]
                            focus:border-[--color-primary] focus:ring-2 focus:ring-[--color-primary]/20"
                />
            </div>
            <button
                type="submit"
                disabled={isChecking || !url.trim()}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2 shadow-lg text-white
                    ${isChecking || !url.trim()
                        ? 'bg-[--bg-active] text-[--text-muted] cursor-not-allowed shadow-none'
                        : 'bg-[--color-primary] hover:bg-[--color-primary-hover] active:scale-95 shadow-[--color-primary]/25'
                    }`}
            >
                {isChecking ? (
                    <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>처리 중</span>
                    </>
                ) : (
                    <>
                        <span>다운로드</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                    </>
                )}
            </button>
        </form>
    )
}