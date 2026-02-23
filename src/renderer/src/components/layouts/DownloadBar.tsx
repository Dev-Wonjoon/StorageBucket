import React, { useState } from 'react';
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'; 

interface DownloadBarProps {
    isDarkMode?: boolean;
    onToggleTheme?: () => void;
}

export function DownloadBar({ isDarkMode, onToggleTheme }: DownloadBarProps) {
    const [url, setUrl] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    
    const { startDownload } = useDownloadViewModel(); 

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;

        setIsChecking(true);
        startDownload(url);

        setTimeout(() => {
            setIsChecking(false);
            setUrl('');
        }, 1000);
    }

    return (
        <div className="w-full max-w-4xl mx-auto flex gap-3">
            <form onSubmit={handleSubmit} className="flex-1 flex gap-3">
                {/* 입력창 영역 */}
                <div className="relative flex-1 group">
                    {/* 링크 아이콘 */}
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        {/* 아이콘 색상: 기본 muted -> 포커스 시 primary */}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" 
                             className="w-5 h-5 transition-colors text-[var(--text-muted)] group-focus-within:text-[var(--color-primary)]">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                    </div>
                    
                    {/* Input 필드 (CSS 변수 적용) */}
                    <input 
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="다운로드할 링크를 붙여넣으세요..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border transition-all shadow-sm outline-none
                                   bg-[var(--bg-sidebar)] 
                                   border-[var(--border-line)]
                                   text-[var(--text-main)]
                                   placeholder-[var(--text-placeholder)]
                                   focus:border-[var(--color-primary)] 
                                   focus:ring-2 focus:ring-[var(--color-primary)]/20"
                    />
                </div>

                {/* 다운로드 버튼 */}
                <button
                    type="submit"
                    disabled={isChecking || !url.trim()}
                    className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2 shadow-lg
                        ${isChecking || !url.trim()
                            ? 'bg-[var(--bg-active)] text-[var(--text-muted)] cursor-not-allowed shadow-none'
                            : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white active:scale-95 shadow-[var(--color-primary)]/25'
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

            {/* 테마 토글 버튼 (CSS 변수 적용) */}
            {onToggleTheme && (
                <button
                    onClick={onToggleTheme}
                    className="px-3 py-2.5 rounded-xl border transition-all shadow-sm
                               bg-[var(--bg-sidebar)]
                               border-[var(--border-line)]
                               text-[var(--text-muted)]
                               hover:bg-[var(--bg-hover)]
                               active:scale-95"
                    title={isDarkMode ? "라이트 모드로 전환" : "다크 모드로 전환"}
                >
                    {isDarkMode ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                    )}
                </button>
            )}
        </div>
    );
}