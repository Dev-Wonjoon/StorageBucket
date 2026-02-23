import { useState } from "react";
import { Sidebar } from "./components/layouts/Sidebar";
import { DownloadBar } from "./components/layouts/DownloadBar";
import { DownloadStatusPanel } from "./components/layouts/DownloadStatusPanel";
import { GalleryPage } from "./features/gallery/GalleryPage";

function App() {
	const [activeMenu, setActiveMenu] = useState('galley');

	const renderContent = () => {
        switch (activeMenu) {
            case 'gallery':
                return <GalleryPage />;
            case 'search':
                return (
                    <div className="flex items-center justify-center h-full text-[--text-muted]">
                        검색기능 준비 중...
                    </div>
                );
            case 'favorites':
                return (
                    <div className="flex items-center justify-center h-full text-[--text-muted]">
                        즐겨찾기 준비 중...
                    </div>
                );
            case 'settings':
                return (
                    <div className="flex items-center justify-center h-full text-[--text-muted]">
                        설정 준비 중...
                    </div>
                );
            default:
                return <GalleryPage />;
    	}
	};

	return (
		<div className="flex h-screen w-full bg-[--bg-app] text-[--text-main] overflow-hidden font-sans transition-colors duration-200">
            {/* 1. 좌측 사이드 바 */}
            <div className="w-64 flex-none h-full">
                <Sidebar activeMenu={activeMenu} onMenuClick={setActiveMenu}/>
            </div>

            {/* 2. 우측 메인 영역 */}
            <div className="flex-1 flex flex-col h-full min-w-0 relative">
                

                <div className="flex-none p-4 h-20 border-b border-[--border-line] bg-[--bg-app]/95 backdrop-blur-sm z-10">
                    <DownloadBar />
                </div>      

                {/* 2-2. 중앙 컨텐츠 (스크롤 가능 영역) */}
                <main className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-[--bg-active] scrollbar-track-transparent">
                    {renderContent()}
                </main>

                {/* 2-3. 하단 다운로드 패널 (고정) */}
                <DownloadStatusPanel />
                
            </div>
        </div>
	)
}

export default App;